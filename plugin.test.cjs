'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('./magpie-proma.cjs');
const { SyncEngine, parseBridge, MANAGED_ID } = require('./sync-engine.cjs');
const { NATIVE_PREFIX } = require('./native-channels.cjs');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'proma-plugin-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.proma'));
  const key = crypto.randomBytes(32);
  let running = false;
  const engine = new SyncEngine({ home, appData: home, dependencies: {
    assessCompatibility: () => ({ ok: true, code: 'fixture' }),
    loadEncryptionKey: () => Buffer.from(key),
    promaIsRunning: () => running,
    writeConfig: (file, original, config) => core.writeConfig(file, original, config, { isRunning: () => running }),
  } });
  const other = { id: 'other', name: 'Keep', apiKey: core.encryptToken(key, 'original-private-token'), enabled: true, models: [] };
  const original = { version: 5, channels: [other], unknownField: 'keep' };
  fs.writeFileSync(engine.file, JSON.stringify(original));
  const manifest = models => fs.writeFileSync(engine.manifest, JSON.stringify({ bridge: {
    version: 1, gateway: 'http://127.0.0.1:3425', key: 'magpie-proma-key', models: models.map(id => ({ id, name: id })),
  } }));
  return { engine, key, other, original, manifest, setRunning: value => { running = value; }, read: () => JSON.parse(fs.readFileSync(engine.file)) };
}

test('Agent export is valid, uses dotted key ownership and delegates model choice to Proma', async () => {
  const { agent, connect } = await import('./agent.js');
  assert.equal(agent.id, 'proma');
  assert.equal(agent.model, undefined);
  const result = connect({ gateway: { url: 'http://127.0.0.1:3425', key: 'agent-key' }, models: [{ id: 'p/m', name: 'Model' }] });
  assert.equal(result['bridge.key'], 'agent-key');
  assert.equal(parseBridge({ bridge: Object.fromEntries(Object.entries(result).map(([k, v]) => [k.slice(7), v])) }).models[0].id, 'p/m');
  assert.throws(() => connect({ gateway: {}, models: [] }));
});

test('rejects external gateways and malformed or empty model catalogs', () => {
  const base = { version: 1, gateway: 'http://127.0.0.1:3425', key: 'k', models: [{ id: 'p/m' }] };
  for (const gateway of ['https://example.com', 'http://127.0.0.1.evil.test', 'file:///test', 'http://user@localhost:3425', 'http://localhost:3425/path']) {
    assert.throws(() => parseBridge({ bridge: { ...base, gateway } }));
  }
  assert.throws(() => parseBridge({ bridge: { ...base, models: [] } }));
  assert.throws(() => parseBridge({ bridge: { ...base, models: [{ id: 'unqualified' }] } }));
  assert.equal(parseBridge({ bridge: {} }), null);
  assert.equal(parseBridge({}), null);
  assert.throws(() => parseBridge({ bridge: null }));
});

test('ongoing sync waits for exit, updates models, preserves edits, and avoids repeated backups', async t => {
  const f = fixture(t);
  f.manifest(['provider/gpt-6-luna', 'provider/gpt-6-astra']);
  f.setRunning(true);
  const before = fs.readFileSync(f.engine.file);
  assert.match((await f.engine.tick()).status, /等待 Proma/);
  assert.deepEqual(fs.readFileSync(f.engine.file), before);
  f.setRunning(false);
  assert.equal((await f.engine.tick()).status, '同步完成');
  let config = f.read();
  assert.deepEqual(config.channels[0], f.other);
  assert.equal(config.unknownField, 'keep');
  const channel = config.channels.find(c => c.id.startsWith(NATIVE_PREFIX));
  assert.equal(core.decryptToken(f.key, channel.apiKey), 'magpie-proma-key');
  channel.models[0].enabled = false;
  channel.models[0].name = 'My model';
  fs.writeFileSync(f.engine.file, JSON.stringify(config));
  f.manifest(['provider/gpt-5.6-sol', 'provider/gpt-6-astra']);
  assert.equal((await f.engine.tick()).status, '同步完成');
  config = f.read();
  const latest = config.channels.find(c => c.id.startsWith(NATIVE_PREFIX));
  assert.deepEqual(latest.models.map(m => [m.id, m.enabled]), [['gpt-5.6-sol', true], ['gpt-6-astra', false]]);
  assert.equal(latest.models[1].name, 'My model');
  const saved = fs.readFileSync(f.engine.file);
  const backups = fs.readdirSync(path.dirname(f.engine.file)).filter(n => n.includes('magpie-backup'));
  assert.equal(backups.length, 2);
  assert.equal((await f.engine.tick()).status, '已同步');
  assert.deepEqual(fs.readFileSync(f.engine.file), saved);
  assert.equal(fs.readdirSync(path.dirname(f.engine.file)).filter(n => n.includes('magpie-backup')).length, 2);
  fs.writeFileSync(f.engine.manifest, '{}');
  assert.equal((await f.engine.tick()).status, '专用渠道已移除');
  assert.deepEqual(f.read().channels, [f.other]);
});

test('invalid manifest and inspection never overwrite config', async t => {
  const f = fixture(t);
  f.manifest(['p/gpt-6-luna']);
  const before = fs.readFileSync(f.engine.file);
  assert.match((await f.engine.tick({ checkOnly: true })).status, /检查通过/);
  assert.deepEqual(fs.readFileSync(f.engine.file), before);
  fs.writeFileSync(f.engine.manifest, '{broken');
  await assert.rejects(f.engine.tick());
  assert.deepEqual(fs.readFileSync(f.engine.file), before);
});

test('disconnect reports pending removal while Proma runs, then removes only managed channels on exit', async t => {
  const f = fixture(t);
  f.manifest(['codex/gpt-6-astra', 'provider/claude-opus-4-6']);
  await f.engine.tick();
  const original = fs.readFileSync(f.engine.file);
  const managedCount = f.read().channels.filter(c => c.id.startsWith(NATIVE_PREFIX)).length;
  fs.writeFileSync(f.engine.manifest, '{"bridge":{}}');
  f.setRunning(true);
  for (const checkOnly of [false, true]) {
    const pending = await f.engine.tick({ checkOnly });
    assert.equal(pending.code, 'disconnect-pending');
    assert.equal(pending.pendingCleanup, true);
    assert.equal(pending.pendingChannels, managedCount);
    assert.match(pending.status, /接入已关闭/);
    assert.deepEqual(fs.readFileSync(f.engine.file), original);
  }
  f.setRunning(false);
  const removed = await f.engine.tick();
  assert.equal(removed.status, '专用渠道已移除');
  assert.equal(removed.removedChannels, managedCount);
  assert.deepEqual(f.read().channels, [f.other]);
  assert.equal((await f.engine.tick()).status, '接入已关闭');
});

test('writer rejects concurrent locks and changed configuration', t => {
  const f = fixture(t);
  const original = fs.readFileSync(f.engine.file);
  fs.writeFileSync(`${f.engine.file}.magpie-sync.lock`, 'locked');
  assert.throws(() => core.writeConfig(f.engine.file, original, f.original, { isRunning: () => false }), /EEXIST/);
  fs.unlinkSync(`${f.engine.file}.magpie-sync.lock`);
  fs.writeFileSync(f.engine.file, 'changed');
  assert.throws(() => core.writeConfig(f.engine.file, original, f.original, { isRunning: () => false }), /其他进程/);
  assert.equal(fs.readFileSync(f.engine.file, 'utf8'), 'changed');
  assert.equal(fs.existsSync(`${f.engine.file}.magpie-sync.lock`), false);
});

test('sync adds native reasoning channels and removes them when the Agent disconnects', async t => {
  const f = fixture(t);
  f.manifest(['codex/gpt-6.1-sol', 'workbuddy-ai/kimi-k3']);
  assert.equal((await f.engine.tick()).status, '同步完成');
  const config = f.read();
  const native = config.channels.filter(c => c.id.startsWith('magpie-proma-native-'));
  assert.equal(native.length, 2);
  assert.equal(native.find(c => c.provider === 'openai-responses').models[0].magpieModelId, 'codex/gpt-6.1-sol');
  assert.equal((await f.engine.tick()).status, '已同步');
  fs.writeFileSync(f.engine.manifest, '{}');
  assert.equal((await f.engine.tick()).status, '专用渠道已移除');
  assert.deepEqual(f.read().channels, [f.other]);
});

test('legacy all-model channel is removed permanently while native preferences survive', async t => {
  const f = fixture(t);
  const original = f.read();
  original.channels.push({ id: MANAGED_ID, name: 'Magpie 本机', apiKey: core.encryptToken(f.key, 'magpie-proma-key'), models: [{ id: 'codex/gpt-6-luna', name: 'Luna', enabled: false }] });
  fs.writeFileSync(f.engine.file, JSON.stringify(original));
  f.manifest(['codex/gpt-6-luna']);
  assert.equal((await f.engine.tick()).status, '同步完成');
  assert(!f.read().channels.some(c => c.id === MANAGED_ID));
  assert.equal(f.read().channels.find(c => c.id.startsWith(NATIVE_PREFIX)).models[0].enabled, false);
  const saved = fs.readFileSync(f.engine.file);
  const restarted = new SyncEngine({ home: path.dirname(path.dirname(f.engine.file)), appData: 'unused', dependencies: f.engine.deps });
  assert.equal((await restarted.tick()).status, '已同步');
  assert.deepEqual(fs.readFileSync(f.engine.file), saved);
});
