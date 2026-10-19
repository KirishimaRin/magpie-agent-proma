'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const capability = require('./reasoning-capabilities.cjs');
const { nativeModel } = require('./native-channels.cjs');
const { buildRoutes } = require('./native-channels.cjs');
const { createNativeProxy, listen } = require('./native-proxy.cjs');
const http = require('node:http');

const catalog = {
  stepfun: { models: { 'step-5-preview': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }] } } },
  xai: { models: { 'grok-4.7': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }] } } },
};

test('provider catalog takes priority, including explicit no-adjustment declarations', () => {
  const records = capability.indexModelsDev(catalog);
  assert.deepEqual(capability.resolveCapability({ id: 'grok/grok-4.7' }, { reasoning: true, reasoning_levels: [] }, records).levels, []);
  assert.deepEqual(capability.resolveCapability({ id: 'grok/grok-4.7' }, { reasoning: true, reasoning_levels: ['low', 'high'] }, records).levels, ['low', 'high']);
  const fallback = capability.resolveCapability({ id: 'workbuddy/step-5-preview' }, undefined, records);
  assert.equal(fallback.source, 'models.dev');
  assert.deepEqual(fallback.levels, ['low', 'medium', 'high']);
  assert.equal(capability.lookupModelsDev('relay/step-5-preview-unrelated', records), undefined);
});

test('template choices contain only supported source levels and preserve actual model identity', () => {
  for (const levels of [[], ['high'], ['low', 'xhigh']]) assert.equal(capability.matchTemplate({ reasoning: true, levels }), undefined);
  const template = capability.matchTemplate({ reasoning: true, levels: ['low', 'medium', 'high', 'xhigh'] });
  assert.equal(template.id, 'gemini-3.1-pro');
  assert.deepEqual(template.levels, ['low', 'medium', 'high']);
  const model = nativeModel({ id: 'workbuddy-ai/step-5-preview', name: 'Step 5', capability: { reasoning: true, levels: ['low', 'medium', 'high'] } });
  assert.equal(model.id, 'gemini-3.1-pro');
  assert.equal(model.upstream, 'workbuddy-ai/step-5-preview');
  assert.equal(model.name, 'Step 5');
  const original = nativeModel({ id: 'codex/gpt-6-astra', capability: { reasoning: true, levels: ['low', 'medium', 'high', 'xhigh', 'max'] } });
  assert.equal(original.protocol, 'responses');
  assert.equal(original.reasoningTemplate, undefined);
  const opaque = nativeModel({ id: 'provider/opaque-model', capability: { reasoning: true, levels: ['low', 'high', 'max'] } });
  assert.equal(opaque.id, 'glm-5.3');
  assert.equal(opaque.upstream, 'provider/opaque-model');
});

test('metadata refresh is cached, omits credentials, and keeps data when sources fail', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proma-capabilities-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifest = path.join(directory, 'bridge.json');
  const bridge = { endpoint: 'http://127.0.0.1:3425/v1/messages', key: 'private-key-never-cache', models: [{ id: 'workbuddy/step-5-preview' }] };
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push(url);
    if (url.startsWith('https://models.dev')) {
      assert.equal(options.headers, undefined);
      return { ok: true, json: async () => catalog };
    }
    assert.equal(options.headers.authorization, `Bearer ${bridge.key}`);
    return { ok: true, json: async () => ({ data: [{ id: 'workbuddy/step-5-preview', reasoning: true, reasoning_levels: ['low', 'medium', 'high'] }] }) };
  };
  const now = 100000000;
  await capability.refreshCapabilities(bridge, manifest, { fetchFn, now });
  assert.equal(calls.length, 2);
  const cache = path.join(directory, 'magpie-capabilities.json');
  assert(!fs.readFileSync(cache, 'utf8').includes(bridge.key));
  const enriched = capability.enrichCapabilities(bridge, manifest);
  assert.deepEqual(enriched.models[0].capability.levels, ['low', 'medium', 'high']);
  await capability.refreshCapabilities(bridge, manifest, { fetchFn, now: now + 10000 });
  assert.equal(calls.length, 2);
  const status = await capability.refreshCapabilities(bridge, manifest, { fetchFn: async () => { throw new Error('offline'); }, now: now + 25 * 3600000 });
  assert.equal(status.failed, 2);
  assert.deepEqual(capability.enrichCapabilities(bridge, manifest).models[0].capability.levels, ['low', 'medium', 'high']);
});

test('dynamic menu aliases forward the selected strength to the real model or routing group', async t => {
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks)) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await listen(upstream, 0);
  const bridge = { key: 'test', endpoint: `http://127.0.0.1:${upstream.address().port}/v1/messages`, models: [
    { id: 'workbuddy/step-5-preview', name: 'Step', capability: { reasoning: true, levels: ['low', 'medium', 'high'] } },
    { id: 'group/my-step', name: 'Step group', groupMembers: ['workbuddy/step-5-preview'], capability: { reasoning: true, levels: ['low', 'medium', 'high'] } },
  ] };
  const proxy = createNativeProxy({ loadBridge: () => bridge });
  await listen(proxy, 0);
  t.after(() => { proxy.closeAllConnections(); proxy.close(); upstream.closeAllConnections(); upstream.close(); });
  const routes = [...buildRoutes(bridge.models)];
  for (const [route, metadata] of routes) {
    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/p/${route}/v1beta/models/gemini-3.1-pro:generateContent`, {
      method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [], generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } } }),
    });
    assert.equal(response.status, 200);
    await response.text();
    const actual = [...metadata.models.values()][0];
    assert.equal(seen.at(-1).url, `/v1beta/models/${actual.upstream}:generateContent`);
    assert.equal(seen.at(-1).body.generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
  }
  const response = await fetch(`http://127.0.0.1:${proxy.address().port}/p/${routes[0][0]}/v1beta/models/gemini-3.1-pro:generateContent`, {
    method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
    body: JSON.stringify({ generationConfig: { thinkingConfig: { thinkingLevel: 'XHIGH' } } }),
  });
  assert.equal(response.status, 400);
  assert.equal(seen.length, 2);
});
