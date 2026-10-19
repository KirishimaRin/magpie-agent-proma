'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { knownNativeMenu, matchTemplate } = require('./reasoning-capabilities.cjs');
const NATIVE_PREFIX = 'magpie-proma-native-';
const PROXY_ORIGIN = 'http://127.0.0.1:3426';

function baseNativeModel(model) {
  const separator = model.id.lastIndexOf('/');
  const source = model.id.slice(0, separator);
  const rawId = model.id.slice(separator + 1);
  let id = rawId;
  if (source === 'group') {
    const groupName = (model.name || rawId).replace(/\s*·\s*routing group$/i, '');
    const members = (model.groupMembers || []).map(id => nativeModel({ id })).filter(Boolean);
    const sameFamily = members.length > 0 && members.length === model.groupMembers.length && members.every(member => member.id === members[0].id && member.protocol === members[0].protocol);
    return {
      source, bucket: `${source}@${rawId}`, alias: groupName,
      id: sameFamily ? members[0].id : rawId,
      protocol: sameFamily ? members[0].protocol : 'chat',
      upstream: model.id, name: groupName,
    };
  }
  if (/^(?:glm-5\.[23](?:-flashx?)?|kimi-k3)-free$/i.test(id)) id = id.slice(0, -5);
  // Proma 0.19.x recognizes these protocol families under their previous catalog IDs.
  // Only the local UI alias changes; requests are always rewritten to the original ID.
  if (/^gpt-6\.1-sol$/i.test(id)) id = 'gpt-6-astra';
  if (/^deepseek-v4\.1-flash(?:-free)?$/i.test(id)) id = 'deepseek-v4-flash';
  if (!/^(?:gpt-|o[134](?:-|$)|gemini-|claude-|kimi-|glm-|deepseek-|minimax-|mimo-|grok-|step-)/i.test(id)) return null;
  const protocol = /^(?:gpt-|o[134](?:-|$))/i.test(id) ? 'responses'
    : /^gemini-/i.test(id) ? 'google'
      : /^(?:claude-|deepseek-|kimi-|glm-)/i.test(id) ? 'anthropic' : 'chat';
  return { source, bucket: id === rawId ? source : `${source}@${rawId}`, alias: id !== rawId ? rawId : null, id, protocol, upstream: model.id, name: model.name || rawId };
}

function nativeModel(model) {
  const slash = model.id.lastIndexOf('/');
  const source = model.id.slice(0, slash), rawId = model.id.slice(slash + 1);
  const native = baseNativeModel(model) || (model.capability?.reasoning === true ? {
    source, bucket: source, id: rawId, protocol: 'chat', upstream: model.id, name: model.name || rawId,
  } : null);
  if (!native) return null;
  Object.assign(native, { context: model.context, output: model.output, images: model.images });
  const template = (!knownNativeMenu(native) || model.capability?.template) && matchTemplate(model.capability);
  if (!template) return native;
  return {
    ...native, id: template.id, protocol: template.protocol,
    bucket: `${source}@${rawId}`, alias: native.alias || rawId,
    reasoningTemplate: template.id, templateLevels: template.levels,
  };
}

function attachGroupMembers(bridge, groups) {
  if (!bridge) return bridge;
  const index = new Map((Array.isArray(groups) ? groups : []).map(group => [group.id, group]));
  function expand(id, visiting = new Set()) {
    if (!id.startsWith('group/')) return [id];
    if (visiting.has(id)) return [];
    const group = index.get(id.slice(6));
    // Magpie's discovered auto-* groups are not persisted until edited.
    // Match exact catalog model slugs to recover their capability family;
    // routing still goes to the original group, never these individual entries.
    if (!group && id.startsWith('group/auto-')) {
      return bridge.models.filter(model => !model.id.startsWith('group/') &&
        'group/auto-' + model.id.slice(model.id.lastIndexOf('/') + 1).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === id).map(model => model.id);
    }
    if (!Array.isArray(group?.members) || !group.members.length) return [];
    const next = new Set(visiting).add(id);
    const leaves = group.members.map(member => typeof member === 'string' ? expand(member, next) : []);
    return leaves.every(list => list.length) ? leaves.flat() : [];
  }
  return { ...bridge, models: bridge.models.map(model => model.id.startsWith('group/') ? { ...model, groupMembers: expand(model.id) } : model) };
}

function enrichGroups(bridge, providersFile) {
  if (!bridge) return bridge;
  const file = providersFile || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'magpie', 'providers.json');
  const groups = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).groups : [];
  return attachGroupMembers(bridge, groups);
}

function routeKey(source, protocol) {
  return `${Buffer.from(source).toString('base64url')}/${protocol}`;
}

function buildRoutes(models) {
  const routes = new Map();
  for (const model of models) {
    const native = nativeModel(model);
    if (!native) continue;
    const key = routeKey(native.bucket, native.protocol);
    if (!routes.has(key)) routes.set(key, { source: native.source, alias: native.alias, protocol: native.protocol, models: new Map() });
    const route = routes.get(key);
    if (route.models.has(native.id) && route.models.get(native.id).upstream !== native.upstream) {
      // Preserve distinct names if a provider exposes both a free alias and its native name.
      route.models.set(model.id.slice(model.id.lastIndexOf('/') + 1), { ...native, id: model.id.slice(model.id.lastIndexOf('/') + 1) });
    } else route.models.set(native.id, native);
  }
  return routes;
}

function mergeNativeChannels(config, bridge, encryptedKey, now = Date.now(), { origin = PROXY_ORIGIN } = {}) {
  const oldById = new Map(config.channels.map(channel => [channel.id, channel]));
  const legacyModels = new Map(config.channels.filter(c => c.id === 'magpie-proma-agent-v1').flatMap(c => c.models || []).map(m => [m.id, m]));
  const preferences = new Map(config.channels.filter(c => c.id.startsWith(NATIVE_PREFIX)).flatMap(channel => (channel.models || []).map(model => [model.magpieModelId, { model, channel }])));
  const channels = [];
  for (const [routeId, route] of buildRoutes(bridge.models)) {
    const id = NATIVE_PREFIX + crypto.createHash('sha256').update(routeId).digest('hex').slice(0, 16);
    const previous = oldById.get(id);
    const migrated = [...route.models.values()].map(model => preferences.get(model.upstream)).filter(Boolean);
    const oldModels = new Map((previous?.models || []).map(model => [model.id, model]));
    const base = `${origin}/p/${routeId}`;
    const label = { responses: 'GPT', google: 'Gemini', anthropic: 'Messages', chat: 'Chat' }[route.protocol];
    const channel = {
      ...previous, id,
      name: previous?.name || `Magpie · ${route.source === 'group' ? '路由组' : route.source} · ${route.alias || label}`,
      provider: { responses: 'openai-responses', google: 'google', anthropic: 'anthropic-compatible', chat: 'openai' }[route.protocol],
      baseUrl: base + (route.protocol === 'anthropic' ? '/v1/messages' : route.protocol === 'google' ? '' : '/v1'),
      apiKey: encryptedKey,
      models: [...route.models.values()].map(model => {
        const old = oldModels.get(model.id) || preferences.get(model.upstream)?.model;
        const legacy = legacyModels.get(model.upstream);
        const { magpieReasoningTemplate, magpieMenuLevels, ...retained } = old || {};
        return { ...retained, id: model.id, name: old?.name || model.name, enabled: old?.enabled ?? legacy?.enabled ?? true, source: 'fetched', magpieModelId: model.upstream,
          magpieCapabilities: { ...(model.context ? { context: model.context } : {}), ...(model.output ? { output: model.output } : {}), ...(typeof model.images === 'boolean' ? { images: model.images } : {}) },
          ...(model.reasoningTemplate ? { magpieReasoningTemplate: model.reasoningTemplate, magpieMenuLevels: model.templateLevels } : {}),
        };
      }),
      enabled: previous?.enabled ?? (migrated.length ? migrated.every(item => item.channel.enabled !== false) : true),
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
    const { updatedAt: ignoredOld, ...oldData } = previous || {};
    const { updatedAt: ignoredNew, ...newData } = channel;
    if (previous && JSON.stringify(oldData) === JSON.stringify(newData)) channel.updatedAt = previous.updatedAt;
    channels.push(channel);
  }
  return { ...config, channels: [...config.channels.filter(channel => !channel.id.startsWith(NATIVE_PREFIX)), ...channels] };
}

module.exports = { nativeModel, buildRoutes, mergeNativeChannels, attachGroupMembers, enrichGroups, NATIVE_PREFIX, PROXY_ORIGIN };
