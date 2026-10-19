'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createNativeProxy, listen } = require('./native-proxy.cjs');
const { nativeModel, buildRoutes, mergeNativeChannels, attachGroupMembers, NATIVE_PREFIX } = require('./native-channels.cjs');

const models = ['codex/gpt-6.1-sol', 'zed/gpt-6.1-sol', 'workbuddy-ai/kimi-k3', 'workbuddy-ai/glm-5.3', 'antigravity/gemini-3.8-flash', 'antigravity/claude-opus-4-6-thinking', 'group/auto-gpt-6-1-sol'].map(id => ({ id, name: id }));

test('native channels expose recognizable model IDs and preserve exact provider routing', () => {
  const config = { version: 5, channels: [{ id: 'other', models: [] }] };
  const next = mergeNativeChannels(config, { models }, 'encrypted', 1);
  assert.equal(next.channels[0], config.channels[0]);
  const codex = next.channels.find(c => c.name?.includes('codex'));
  const zed = next.channels.find(c => c.name?.includes('zed'));
  assert.notEqual(codex.baseUrl, zed.baseUrl);
  assert.equal(codex.provider, 'openai-responses');
  assert.equal(codex.models[0].id, 'gpt-6-astra');
  assert.equal(codex.models[0].magpieModelId, 'codex/gpt-6.1-sol');
  assert.equal(next.channels.find(c => c.models.some(m => m.id === 'kimi-k3')).provider, 'anthropic-compatible');
  assert.equal(next.channels.find(c => c.models.some(m => m.id.startsWith('gemini'))).provider, 'google');
  assert(next.channels.some(c => c.name?.includes('路由组')));
  codex.models[0].enabled = false;
  codex.models[0].name = 'Custom';
  const twice = mergeNativeChannels(next, { models }, 'encrypted', 2);
  assert.deepEqual(twice, next);
  const removed = mergeNativeChannels(next, { models: [] }, 'encrypted', 3);
  assert.equal(removed.channels.length, 1);
  assert(!removed.channels.some(c => c.id.startsWith(NATIVE_PREFIX)));
});

test('free model aliases keep their upstream ID while exposing native GLM capability names', () => {
  assert.equal(nativeModel({ id: 'free/glm-5.3-flash-free' }).id, 'glm-5.3-flash');
  assert.equal(nativeModel({ id: 'free/glm-5.3-flash-free' }).upstream, 'free/glm-5.3-flash-free');
});

test('routing groups use member capabilities and retain group IDs, including nested and mixed groups', () => {
  const bridge = attachGroupMembers({ models: [
    { id: 'group/primary', name: '主力 GPT' },
    { id: 'group/nested', name: '嵌套组' },
    { id: 'group/mixed', name: '混合组' },
    { id: 'group/cycle', name: '循环组' },
  ] }, [
    { id: 'primary', members: ['codex/gpt-6.1-sol', 'zed/gpt-6.1-sol'] },
    { id: 'nested', members: ['group/primary'] },
    { id: 'mixed', members: ['codex/gpt-6.1-sol', 'workbuddy-ai/glm-5.3'] },
    { id: 'cycle', members: ['group/cycle'] },
  ]);
  const native = bridge.models.map(nativeModel);
  assert.equal(native[0].id, 'gpt-6-astra');
  assert.equal(native[0].protocol, 'responses');
  assert.equal(native[0].upstream, 'group/primary');
  assert.equal(native[1].id, 'gpt-6-astra');
  assert.equal(native[2].id, 'mixed');
  assert.equal(native[2].protocol, 'chat');
  assert.equal(native[3].protocol, 'chat');
  const routes = buildRoutes(bridge.models);
  assert.equal(routes.size, 4);
  const changed = attachGroupMembers({ models: [{ id: 'group/primary' }] }, [{ id: 'primary', members: ['workbuddy-ai/glm-5.3'] }]);
  assert.equal(nativeModel(changed.models[0]).id, 'glm-5.3');
  const automatic = attachGroupMembers({ models: [
    { id: 'group/auto-gpt-6-1-sol', name: 'GPT-6.1-Sol' },
    { id: 'codex/gpt-6.1-sol' }, { id: 'zed/gpt-6.1-sol' },
  ] }, []);
  assert.equal(nativeModel(automatic.models[0]).id, 'gpt-6-astra');
  assert.equal(nativeModel(automatic.models[0]).protocol, 'responses');
});

test('proxy preserves reasoning, tools, SSE, upstream errors, and Gemini routing', async t => {
  const requests = [];
  let status = 200;
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks)), key: req.headers.authorization });
    res.writeHead(status, { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' });
    res.end(status === 200 ? 'data: {"type":"response.completed"}\n\n' : '{"error":{"message":"MAGPIE_QUALITY_REVIEW_REQUIRED"}}');
  });
  await listen(upstream, 0);
  const bridge = attachGroupMembers({ key: 'test-key', endpoint: `http://127.0.0.1:${upstream.address().port}/v1/messages`, models }, [
    { id: 'auto-gpt-6-1-sol', members: ['codex/gpt-6.1-sol', 'zed/gpt-6.1-sol'] },
  ]);
  const proxy = createNativeProxy({ loadBridge: () => bridge });
  await listen(proxy, 0);
  t.after(() => { proxy.closeAllConnections(); proxy.close(); upstream.closeAllConnections(); upstream.close(); });
  const origin = `http://127.0.0.1:${proxy.address().port}`;
  const routes = [...buildRoutes(bridge.models)];
  const codex = routes.find(([, route]) => route.source === 'codex')[0];
  const gemini = routes.find(([, route]) => route.protocol === 'google')[0];
  const kimi = routes.find(([, route]) => route.models.has('kimi-k3'))[0];
  async function post(route, suffix, body, key = bridge.key) {
    return fetch(`${origin}/p/${route}${suffix}`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
  const body = { model: 'gpt-6-astra', reasoning: { effort: 'xhigh' }, tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object' } }], input: 'test', stream: true };
  const response = await post(codex, '/v1/responses', body);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'data: {"type":"response.completed"}\n\n');
  assert.deepEqual(requests[0].body, { ...body, model: 'codex/gpt-6.1-sol' });
  assert.equal(requests[0].key, 'Bearer test-key');
  const messages = { model: 'kimi-k3', messages: [{ role: 'user', content: 'test' }], thinking: { type: 'adaptive' }, output_config: { effort: 'max' } };
  await (await post(kimi, '/v1/messages', messages)).text();
  assert.deepEqual(requests[1].body, { ...messages, model: 'workbuddy-ai/kimi-k3' });
  const google = { contents: [], generationConfig: { thinkingConfig: { thinkingLevel: 'high' } } };
  await (await post(gemini, '/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse', google)).text();
  assert.equal(requests[2].url, '/v1beta/models/antigravity/gemini-3.8-flash:streamGenerateContent?alt=sse');
  assert.deepEqual(requests[2].body, google);
  status = 403;
  const gated = await post(codex, '/v1/responses', body);
  assert.equal(gated.status, 403);
  assert.match(await gated.text(), /MAGPIE_QUALITY_REVIEW_REQUIRED/);
  assert.equal((await post(codex, '/v1/responses', body, 'bad-key')).status, 401);
  assert.equal((await post(codex, '/v1/responses', { model: 'gpt-6-sol' })).status, 400);
  assert.equal((await post(codex, '/v1/chat/completions', body)).status, 404);
  assert.equal(requests.length, 4);
  status = 200;
  const groupRoute = routes.find(([, route]) => route.source === 'group')[0];
  await (await post(groupRoute, '/v1/responses', body)).text();
  assert.equal(requests[4].body.model, 'group/auto-gpt-6-1-sol');
  assert.deepEqual(requests[4].body.reasoning, { effort: 'xhigh' });
});
