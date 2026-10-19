'use strict';
const fs = require('node:fs');
const path = require('node:path');
const LEVELS = ['none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const TEMPLATES = [
  { id: 'gpt-6-astra', protocol: 'responses', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'glm-5.3', protocol: 'anthropic', levels: ['low', 'high', 'max'] },
  { id: 'gemini-3.1-pro', protocol: 'google', levels: ['low', 'medium', 'high'] },
  { id: 'gemini-3-flash-preview', protocol: 'google', levels: ['minimal', 'low', 'medium', 'high'] },
];

function normalizeLevels(values) {
  if (!Array.isArray(values)) return [];
  const supplied = new Set(values.map(value => typeof value === 'string' ? value : value?.effort).filter(value => LEVELS.includes(value)));
  return LEVELS.filter(value => supplied.has(value));
}

function knownNativeMenu(native) {
  const id = native.id.toLowerCase();
  if (native.protocol === 'responses') return /^(?:gpt-5|gpt-6(?:-astra|-sol|-luna)|o[134](?:-|$))/.test(id);
  if (native.protocol === 'anthropic') return /^claude-/.test(id) || /^(?:kimi-k3|glm-5\.[23](?:-flashx?)?)$/.test(id) || /^deepseek-(?:v4-|flash(?:-|$))/.test(id);
  if (native.protocol === 'google') return /^gemini-(?:3(?:\.[13578])?)-/.test(id);
  return false;
}

function matchTemplate(capability) {
  const actual = normalizeLevels(capability?.levels);
  if (capability?.reasoning === false || actual.length < 2) return undefined;
  // Expose only real, adjustable source levels. Never rename or clamp a requested level.
  return TEMPLATES.filter(template => template.levels.every(level => actual.includes(level)))
    .sort((a, b) => b.levels.length - a.levels.length)[0];
}

function indexModelsDev(document) {
  const records = [];
  for (const [provider, data] of Object.entries(document || {})) {
    for (const [id, model] of Object.entries(data?.models || {})) {
      const options = (model.reasoning_options || []).filter(option => option.type === 'effort');
      records.push({ provider, id, canonical: model.canonical_model_id, reasoning: model.reasoning,
        levels: normalizeLevels(options.flatMap(option => option.values || [])) });
    }
  }
  return records;
}

function lookupModelsDev(id, records) {
  const firstSlash = id.indexOf('/');
  const source = id.slice(0, firstSlash);
  const raw = id.slice(firstSlash + 1).toLowerCase();
  const tail = raw.slice(raw.lastIndexOf('/') + 1);
  const preferred = { codex: 'openai', zed: 'openai', grok: 'xai', 'opencode-zen-free': 'opencode' }[source] || source;
  const exact = records.filter(model => model.id.toLowerCase() === raw || model.id.toLowerCase() === tail || model.canonical?.toLowerCase() === raw);
  const owned = exact.filter(model => model.provider === preferred);
  const matches = owned.length ? owned : exact;
  if (!matches.length) return undefined;
  const adjustable = matches.filter(model => model.levels.length);
  // Different providers can expose different capabilities under the same model name.
  const levels = adjustable.length ? adjustable[0].levels.filter(level => adjustable.every(model => model.levels.includes(level))) : [];
  return { reasoning: matches.some(model => model.reasoning === true), levels, source: 'models.dev' };
}

function resolveCapability(model, magpie, records) {
  if (magpie && Object.hasOwn(magpie, 'reasoning_levels')) {
    return { reasoning: magpie.reasoning, levels: normalizeLevels(magpie.reasoning_levels), source: 'magpie' };
  }
  if (Array.isArray(model.efforts)) return { reasoning: model.efforts.length > 0, levels: normalizeLevels(model.efforts), source: 'magpie-agent' };
  return lookupModelsDev(model.id, records);
}

function readSnapshot(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.version === 1 ? data : {};
  } catch { return {}; }
}

function attachCapabilities(bridge, snapshot) {
  if (!bridge) return bridge;
  return { ...bridge, models: bridge.models.map(model => {
    const capability = resolveCapability(model, snapshot.magpie?.[model.id], snapshot.modelsDev || []);
    return capability ? { ...model, capability } : model;
  }) };
}

function enrichCapabilities(bridge, manifest) {
  return attachCapabilities(bridge, readSnapshot(path.join(path.dirname(manifest), 'magpie-capabilities.json')));
}

async function refreshCapabilities(bridge, manifest, { fetchFn = fetch, now = Date.now() } = {}) {
  if (!bridge) return;
  const file = path.join(path.dirname(manifest), 'magpie-capabilities.json');
  const before = readSnapshot(file);
  const ids = bridge.models.map(model => model.id).sort().join('\n');
  const updateMagpie = (before.ids !== ids || !before.magpieAt || now - before.magpieAt > 5 * 60000)
    && (!before.magpieAttemptAt || now - before.magpieAttemptAt >= 30000);
  const updateModelsDev = (!before.modelsDevAt || now - before.modelsDevAt > 24 * 3600000)
    && (!before.modelsDevAttemptAt || now - before.modelsDevAttemptAt >= 15 * 60000);
  if (!updateMagpie && !updateModelsDev) return;
  const snapshot = { ...before, version: 1 };
  const tasks = [];
  if (updateMagpie) tasks.push((async () => {
    snapshot.magpieAttemptAt = now;
    const response = await fetchFn(`${new URL(bridge.endpoint).origin}/v1/models`, {
      headers: { authorization: `Bearer ${bridge.key}` }, redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Magpie catalog unavailable');
    const data = await response.json();
    if (!Array.isArray(data.data) || !data.data.length) throw new Error('Empty Magpie catalog');
    snapshot.magpie = Object.fromEntries(data.data.map(model => [model.id, {
      ...(typeof model.reasoning === 'boolean' ? { reasoning: model.reasoning } : {}),
      ...(Array.isArray(model.reasoning_levels) ? { reasoning_levels: normalizeLevels(model.reasoning_levels) } : {}),
    }]));
    snapshot.magpieAt = now;
    snapshot.ids = ids;
  })());
  if (updateModelsDev) tasks.push((async () => {
    snapshot.modelsDevAttemptAt = now;
    // No credentials or local configuration are sent to models.dev.
    const response = await fetchFn('https://models.dev/api.json', { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('models.dev unavailable');
    const records = indexModelsDev(await response.json());
    if (!records.length) throw new Error('Empty models.dev catalog');
    snapshot.modelsDev = records;
    snapshot.modelsDevAt = now;
  })());
  const results = await Promise.allSettled(tasks);
  const refreshed = results.filter(result => result.status === 'fulfilled').length;
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return { refreshed, failed: results.length - refreshed };
}

module.exports = { TEMPLATES, normalizeLevels, knownNativeMenu, matchTemplate, indexModelsDev, lookupModelsDev,
  resolveCapability, attachCapabilities, enrichCapabilities, refreshCapabilities };
