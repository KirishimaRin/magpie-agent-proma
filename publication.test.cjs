'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { runtimeOptions } = require('./runtime-options.cjs');
const { SyncEngine, parseBridge } = require('./sync-engine.cjs');
const core = require('./magpie-proma.cjs');
const { mergeNativeChannels, NATIVE_PREFIX } = require('./native-channels.cjs');
const { enrichCapabilities } = require('./reasoning-capabilities.cjs');
const { assessCompatibility, readAsarFile } = require('./compatibility.cjs');
const { diagnose, restore } = require('./plugin-tools.cjs');

function fixture(t, compatible = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proma-publication-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const engine = new SyncEngine({ home: directory, appData: directory, options: { promaDirectory: directory, port: 13426 }, dependencies: {
    assessCompatibility: () => ({ ok: compatible, code: 'untested-version', message: '未验证版本' }),
    promaIsRunning: () => false,
    loadEncryptionKey: () => Buffer.from(key),
    writeConfig: (file, original, config) => core.writeConfig(file, original, config, { isRunning: () => false }),
    enrichGroups: bridge => bridge,
  } });
  fs.mkdirSync(path.dirname(engine.manifest), { recursive: true });
  fs.writeFileSync(engine.file, JSON.stringify({ version: 5, channels: [{ id: 'unrelated', apiKey: core.encryptToken(key, 'secret-other'), models: [] }] }));
  fs.writeFileSync(engine.manifest, JSON.stringify({ bridge: { version: 1, key: 'private-bridge-key', gateway: 'http://127.0.0.1:3425', models: [{ id: 'private-provider/step-5-preview', name: 'Secret model name', context: 123456, output: 4096, images: false }] } }));
  return { engine, directory, key };
}

test('runtime options validate loopback ports, absolute paths and booleans', () => {
  for (const options of [{ port: 80 }, { port: '3426' }, { promaDirectory: 'relative' }, { cleanup: 'yes' }]) assert.throws(() => runtimeOptions(options));
  assert.equal(runtimeOptions({ port: 13426 }).origin, 'http://127.0.0.1:13426');
});

test('untested Proma and unknown config schemas leave all configuration bytes intact', { skip: process.platform !== 'win32' }, async t => {
  const { engine } = fixture(t, false);
  const before = fs.readFileSync(engine.file);
  assert.equal((await engine.tick()).code, 'untested-version');
  assert.deepEqual(fs.readFileSync(engine.file), before);
  engine.deps.assessCompatibility = () => ({ ok: true });
  const config = JSON.parse(before); config.version = 999;
  fs.writeFileSync(engine.file, JSON.stringify(config));
  const unknown = fs.readFileSync(engine.file);
  assert.equal((await engine.tick()).code, 'unsupported-schema');
  assert.deepEqual(fs.readFileSync(engine.file), unknown);
  assert(!fs.readdirSync(path.dirname(engine.file)).some(name => name.includes('backup')));
});

test('template migrations preserve real-model preferences, channel state and unrelated fields', () => {
  const model = { id: 'custom/step-5-preview', name: 'Step', context: 12345, output: 5000, images: false };
  const base = { version: 5, channels: [{ id: 'other', enabled: true, models: [] }], defaultModel: 'keep' };
  const before = mergeNativeChannels(base, { models: [model] }, 'key', 1);
  const old = before.channels.find(c => c.id.startsWith(NATIVE_PREFIX));
  old.enabled = false; old.models[0].enabled = false; old.models[0].name = 'My Step';
  const after = mergeNativeChannels(before, { models: [{ ...model, capability: { reasoning: true, levels: ['low', 'medium', 'high'] } }] }, 'key', 2, { origin: 'http://127.0.0.1:13426' });
  const channel = after.channels.find(c => c.id.startsWith(NATIVE_PREFIX));
  assert.notEqual(old.id, channel.id);
  assert.equal(channel.enabled, false);
  assert.equal(channel.models[0].enabled, false);
  assert.equal(channel.models[0].name, 'My Step');
  assert.equal(channel.models[0].magpieModelId, model.id);
  assert.deepEqual(channel.models[0].magpieCapabilities, { context: 12345, output: 5000, images: false });
  assert(channel.baseUrl.startsWith('http://127.0.0.1:13426/'));
  assert.deepEqual(after.channels[0], base.channels[0]);
  assert.equal(after.defaultModel, 'keep');
});

test('user capability overrides support private IDs and reject fabricated template levels', t => {
  const { engine } = fixture(t);
  const bridge = parseBridge(JSON.parse(fs.readFileSync(engine.manifest)));
  assert.equal(bridge.models[0].context, 123456);
  assert.equal(bridge.models[0].images, false);
  const file = path.join(path.dirname(engine.manifest), 'magpie-model-overrides.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, models: { [bridge.models[0].id]: { levels: ['low', 'medium', 'high'], template: 'gemini-3.1-pro' } } }));
  const model = enrichCapabilities(bridge, engine.manifest).models[0];
  assert.equal(model.capability.source, 'user-override');
  assert.equal(model.capability.template, 'gemini-3.1-pro');
  fs.writeFileSync(file, JSON.stringify({ version: 1, models: { [bridge.models[0].id]: { levels: ['low', 'high'], template: 'gemini-3.1-pro' } } }));
  assert.throws(() => enrichCapabilities(bridge, engine.manifest));
});

test('cleanup and restore are repeatable, backup current state and preserve unrelated channels', { skip: process.platform !== 'win32' }, async t => {
  const { engine, directory } = fixture(t);
  await engine.tick();
  const withPlugin = JSON.parse(fs.readFileSync(engine.file));
  const saved = path.join(directory, 'channels.json.magpie-backup-test');
  fs.writeFileSync(saved, JSON.stringify(withPlugin));
  await engine.tick({ remove: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(engine.file)).channels.map(c => c.id), ['unrelated']);
  assert.equal((await engine.tick({ remove: true })).status, '接入已关闭');
  restore(engine, saved);
  assert.deepEqual(JSON.parse(fs.readFileSync(engine.file)), withPlugin);
  assert.throws(() => restore(engine, path.join(directory, 'other.json')));
  const bytes = fs.readFileSync(engine.file);
  engine.deps.promaIsRunning = () => true;
  assert.match((await engine.tick({ remove: true })).status, /等待 Proma/);
  assert.deepEqual(fs.readFileSync(engine.file), bytes);
});

test('doctor output excludes credential values, source URLs, usernames and private model IDs', { skip: process.platform !== 'win32' }, async t => {
  const { engine, directory } = fixture(t);
  const summary = JSON.stringify(await diagnose(engine));
  for (const secret of ['private-bridge-key', 'secret-other', 'Secret model name', 'private-provider', directory, 'http://127.0.0.1:3425']) assert(!summary.includes(secret), secret);
});

test('ASAR parser rejects truncated data and explicit missing installations report version unknown', t => {
  const { directory } = fixture(t);
  const file = path.join(directory, 'broken.asar'); fs.writeFileSync(file, 'short');
  assert.throws(() => readAsarFile(file, ['package.json']));
  const result = assessCompatibility({ promaExecutable: path.join(directory, 'absent.exe') });
  assert.equal(result.code, 'version-unknown'); assert.equal(result.ok, false);
  assert.equal(assessCompatibility({ promaExecutable: path.join(directory, 'absent.exe'), allowUntestedProma: true }).ok, true);
});
