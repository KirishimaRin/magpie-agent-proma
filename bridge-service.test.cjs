'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const core = require('./magpie-proma.cjs');
const { SyncEngine } = require('./sync-engine.cjs');
const { createBridgeService } = require('./bridge-service.cjs');

async function until(predicate, message) {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'proma-events-'));
  fs.mkdirSync(path.join(home, '.proma'));
  const key = crypto.randomBytes(32);
  let running = false;
  const sync = new SyncEngine({ home, appData: home, dependencies: {
    assessCompatibility: () => ({ ok: true }),
    enrichGroups: bridge => bridge,
    promaIsRunning: () => running,
    loadEncryptionKey: () => Buffer.from(key),
    writeConfig: (file, original, config) => core.writeConfig(file, original, config, { isRunning: () => running }),
  } });
  const other = { id: 'other', apiKey: core.encryptToken(key, 'dummy'), models: [] };
  fs.writeFileSync(sync.file, JSON.stringify({ version: 12, channels: [other] }));
  fs.writeFileSync(sync.manifest, '{}');
  const writeBridge = (ids = ['p/gpt-6-astra']) => fs.writeFileSync(sync.manifest, JSON.stringify({ bridge: {
    version: 1, key: 'dummy-agent-key', gateway: 'http://127.0.0.1:1', models: ids.map(id => ({ id, name: id })),
  } }));
  const managed = () => JSON.parse(fs.readFileSync(sync.file)).channels.filter(c => c.id.startsWith('magpie-proma-native-'));
  let service;
  t.after(async () => { await service?.stop(); fs.rmSync(home, { recursive: true, force: true }); });
  const start = async settings => {
    service = createBridgeService({ sync, createProxy: async () => null, intervalMs: 60000, ...settings });
    await service.start();
    return service;
  };
  return { sync, other, start, writeBridge, managed, setRunning: value => { running = value; } };
}

test('connection file events import channels before launching Proma, even while network metadata is blocked', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t);
  let refreshing = false, finish;
  const blocked = new Promise(resolve => { finish = resolve; });
  t.after(() => finish());
  await f.start({ refresh: async () => { refreshing = true; await blocked; } });
  f.writeBridge();
  await until(() => f.managed().length === 1, 'Connection waited for the recovery timer or network');
  await until(() => refreshing, 'Background metadata refresh was not started');
  f.setRunning(true); // Proma now loads a configuration that already contains the channel.
  assert.equal(f.managed()[0].models[0].magpieModelId, 'p/gpt-6-astra');
  assert.equal(JSON.parse(fs.readFileSync(f.sync.file)).channels[0].id, f.other.id);
});

test('file events clean disconnected channels and reconnect without waiting for the polling timer', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t);
  await f.start({ refresh: async () => undefined });
  f.writeBridge();
  await until(() => f.managed().length === 1, 'Connect event was lost');
  fs.writeFileSync(f.sync.manifest, '{"bridge":{}}');
  await until(() => f.managed().length === 0, 'Disconnect event was lost');
  f.writeBridge(['p/claude-opus-4-6']);
  await until(() => f.managed().length === 1, 'Reconnect event was lost');
  assert.equal(f.managed()[0].models[0].magpieModelId, 'p/claude-opus-4-6');
});

test('a connection change during an in-flight sync is replayed instead of dropped', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t);
  let release, entered = false;
  const pending = new Promise(resolve => { release = resolve; });
  const originalTick = f.sync.tick.bind(f.sync);
  let calls = 0;
  f.sync.tick = async options => { calls++; if (calls === 1) { entered = true; await pending; } return originalTick(options); };
  const started = f.start({ refresh: async () => undefined });
  await until(() => entered, 'Initial sync did not start');
  f.writeBridge(['p/gpt-6-astra', 'p/claude-opus-4-6']);
  // Give fs.watch a chance to report the event while the first synchronization is blocked.
  await new Promise(resolve => setTimeout(resolve, 50));
  release();
  await started;
  await until(() => f.managed().length === 2 && calls >= 2, 'Connection changed while busy but no replay occurred');
});
