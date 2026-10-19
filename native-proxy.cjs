'use strict';
const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { buildRoutes, enrichGroups } = require('./native-channels.cjs');
const { parseBridge } = require('./sync-engine.cjs');
const { enrichCapabilities } = require('./reasoning-capabilities.cjs');
const VERSION = '0.4.0';
const LIMIT = 16 * 1024 * 1024;

function authorized(request, key, url) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
    || request.headers['x-api-key'] || request.headers['x-goog-api-key'] || url.searchParams.get('key');
  if (typeof token !== 'string') return false;
  const a = Buffer.from(token), b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function fail(response, code, message) {
  if (!response.headersSent) response.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: { message, type: 'magpie_proma_proxy_error' } }));
}

function createNativeProxy({ loadBridge, requestUpstream = http.request }) {
  return http.createServer(async (request, response) => {
    let upstream;
    try {
      const bridge = loadBridge();
      if (!bridge) return fail(response, 503, '请先在 Magpie 开启 Proma 接入。');
      const url = new URL(request.url, 'http://127.0.0.1');
      if (!authorized(request, bridge.key, url)) return fail(response, 401, '本机接入 Key 无效。');
      if (request.headers.origin) return fail(response, 403, '此接口仅接受本机客户端请求。');
      if (url.pathname === '/health' && request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end(JSON.stringify({ plugin: 'magpie-agent-proma', version: VERSION }));
      }
      const match = url.pathname.match(/^\/p\/([A-Za-z0-9_-]+)\/(responses|google|anthropic|chat)(\/.*)$/);
      const route = match && buildRoutes(bridge.models).get(`${match[1]}/${match[2]}`);
      if (!route) return fail(response, 404, '未知的供应商渠道。');
      const suffix = match[3];
      if (request.method === 'GET' && suffix === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end(JSON.stringify({ object: 'list', data: [...route.models.values()].map(model => ({ id: model.id, object: 'model', owned_by: route.source })) }));
      }
      if (request.method === 'GET' && route.protocol === 'google' && suffix === '/v1beta/models') {
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end(JSON.stringify({ models: [...route.models.values()].map(model => ({ name: `models/${model.id}`, displayName: model.name, supportedGenerationMethods: ['generateContent', 'countTokens'] })) }));
      }
      const google = route.protocol === 'google' && suffix.match(/^\/v1beta\/models\/(.+):(streamGenerateContent|generateContent|countTokens)$/);
      const expected = { responses: '/v1/responses', anthropic: '/v1/messages', chat: '/v1/chat/completions' }[route.protocol];
      if (request.method !== 'POST' || (!google && suffix !== expected && !(route.protocol === 'anthropic' && suffix === '/v1/messages/count_tokens'))) return fail(response, 404, '不支持的协议端点。');
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > LIMIT) return fail(response, 413, '请求体超过 16 MiB。');
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail(response, 400, '请求体必须是 JSON。'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(response, 400, '请求体必须是对象。');
      const modelId = google ? decodeURIComponent(google[1]) : body.model;
      const model = route.models.get(modelId);
      if (!model) return fail(response, 400, '该模型不在此渠道的 Magpie 模型目录中。');
      if (model.templateLevels) {
        const effort = google ? body.generationConfig?.thinkingConfig?.thinkingLevel
          : body.reasoning?.effort || body.reasoning_effort || body.output_config?.effort;
        if (typeof effort === 'string' && !model.templateLevels.includes(effort.toLowerCase())) {
          return fail(response, 400, `该能力模板支持：${model.templateLevels.join(', ')}`);
        }
      }
      const gateway = new URL(bridge.endpoint).origin;
      const target = google ? new URL(`${gateway}/v1beta/models/${model.upstream.split('/').map(encodeURIComponent).join('/')}:${google[2]}`) : new URL(`${gateway}${suffix}`);
      if (google && url.searchParams.get('alt') === 'sse') target.searchParams.set('alt', 'sse');
      if (!google) body.model = model.upstream;
      const data = Buffer.from(JSON.stringify(body));
      const headers = { 'content-type': 'application/json', 'content-length': data.length, authorization: `Bearer ${bridge.key}`, 'user-agent': `Proma-Magpie-Bridge/${VERSION}` };
      for (const name of ['anthropic-version', 'anthropic-beta', 'accept', 'x-request-id']) if (request.headers[name]) headers[name] = request.headers[name];
      upstream = requestUpstream(target, { method: 'POST', headers }, incoming => {
        const outputHeaders = {};
        for (const [name, value] of Object.entries(incoming.headers)) if (!['connection', 'transfer-encoding', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'trailer', 'upgrade'].includes(name)) outputHeaders[name] = value;
        response.writeHead(incoming.statusCode || 502, outputHeaders);
        incoming.on('error', () => response.destroy());
        incoming.pipe(response);
      });
      response.on('close', () => upstream?.destroy());
      upstream.on('error', () => {
        if (response.headersSent) response.destroy();
        else fail(response, 502, 'Magpie 网关连接失败，请确认 Magpie 正在运行。');
      });
      upstream.setTimeout(300000, () => upstream.destroy());
      upstream.end(data);
    } catch {
      upstream?.destroy();
      if (response.headersSent) response.destroy();
      else fail(response, 503, '本机桥接配置不可用，请检查插件状态。');
    }
  });
}

function listen(server, port = 3426) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server); });
  });
}

async function startNativeProxy(manifest) {
  const loadBridge = () => fs.existsSync(manifest) ? enrichCapabilities(enrichGroups(parseBridge(JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '')))), manifest) : null;
  const server = createNativeProxy({ loadBridge });
  try {
    await listen(server);
    return server;
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    const bridge = loadBridge();
    if (!bridge) throw error;
    const result = await fetch('http://127.0.0.1:3426/health', { headers: { authorization: `Bearer ${bridge.key}` }, signal: AbortSignal.timeout(2000), redirect: 'error' });
    const info = await result.json();
    if (!result.ok || info.plugin !== 'magpie-agent-proma' || info.version !== VERSION) throw error;
    return null; // Another Magpie host owns the same compatible proxy.
  }
}

module.exports = { createNativeProxy, listen, startNativeProxy, VERSION };
