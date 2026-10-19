'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const core = require('./magpie-proma.cjs');
const { mergeNativeChannels, enrichGroups, NATIVE_PREFIX } = require('./native-channels.cjs');
const { enrichCapabilities, normalizeLevels } = require('./reasoning-capabilities.cjs');
const MANAGED_ID = 'magpie-proma-agent-v1';
const { runtimeOptions } = require('./runtime-options.cjs');
const { assessCompatibility } = require('./compatibility.cjs');

function parseBridge(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('无效的桥接配置。');
  if (!Object.hasOwn(document, 'bridge')) return null; // Magpie restored the disabled Agent.
  const bridge = document.bridge;
  if (bridge && typeof bridge === 'object' && !Array.isArray(bridge) && !Object.keys(bridge).length) return null;
  if (bridge?.version !== 1 || typeof bridge.key !== 'string' || !bridge.key.trim()) throw new Error('桥接配置版本或 Key 无效。');
  const url = new URL(bridge.gateway);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('此版本只连接本机 HTTP Magpie 网关。');
  }
  if (!Array.isArray(bridge.models) || !bridge.models.length) throw new Error('桥接模型列表为空。');
  const models = [];
  const seen = new Set();
  for (const model of bridge.models) {
    if (typeof model?.id !== 'string' || !model.id.trim() || !model.id.includes('/')) throw new Error('模型必须使用完整的供应商/模型 ID。');
    if (!seen.has(model.id)) {
      models.push({ id: model.id, name: typeof model.name === 'string' && model.name.trim() ? model.name : model.id,
        ...(Array.isArray(model.efforts) ? { efforts: normalizeLevels(model.efforts) } : {}),
        ...(Number.isSafeInteger(model.context) && model.context > 0 ? { context: model.context } : {}),
        ...(Number.isSafeInteger(model.output) && model.output > 0 ? { output: model.output } : {}),
        ...(typeof model.images === 'boolean' ? { images: model.images } : {}),
      });
      seen.add(model.id);
    }
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  return { key: bridge.key, endpoint: `${url.origin}/v1/messages`, models };
}

class SyncEngine {
  constructor({ home = os.homedir(), appData = process.env.APPDATA || '', options = {}, dependencies = {} } = {}) {
    this.options = runtimeOptions(options, { home, appData });
    this.file = path.join(this.options.promaDirectory, 'channels.json');
    this.manifest = this.options.bridgeFile;
    this.state = this.options.localStatePath;
    this.deps = { ...core, enrichGroups, enrichCapabilities, assessCompatibility, ...dependencies };
  }

  async tick({ checkOnly = false, remove = false } = {}) {
    if (process.platform !== 'win32') throw new Error('Proma 同步组件当前支持 Windows。');
    if (!fs.existsSync(this.file)) return { status: '等待 Proma 初始化' };
    if (!remove && !fs.existsSync(this.manifest)) return { status: '等待在 Magpie Agent 页开启 Proma 接入' };
    const manifestBytes = remove ? null : fs.readFileSync(this.manifest);
    const bridge = remove ? null : this.deps.enrichCapabilities(this.deps.enrichGroups(parseBridge(JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''))), this.options.providersFile), this.manifest);
    if (bridge) {
      const compatibility = this.deps.assessCompatibility({ ...this.options, rememberInstallation: !checkOnly });
      if (!compatibility.ok) return { status: compatibility.message, code: compatibility.code, compatibility };
    }
    const original = fs.readFileSync(this.file);
    const stateStamp = fs.existsSync(this.state) ? String(fs.statSync(this.state).mtimeMs) : '';
    const fingerprint = (configBytes) => crypto.createHash('sha256').update(manifestBytes).update(JSON.stringify(bridge?.models)).update(this.options.origin).update(configBytes).update(stateStamp).digest('hex');
    if (bridge && this.lastSyncedInput === fingerprint(original)) return { status: '已同步', count: bridge.models.length };
    const config = JSON.parse(original.toString('utf8').replace(/^\uFEFF/, ''));
    if (!Number.isInteger(config.version) || config.version < 2 || !Array.isArray(config.channels)) throw new Error('不支持的 Proma 配置格式。');
    if (bridge && !require('./capability-rules.json').channelSchemas.includes(config.version)) return { status: 'Proma 渠道格式尚未验证，已保留配置', code: 'unsupported-schema' };
    const existing = config.channels.find(c => c.id === MANAGED_ID);
    let next;
    if (!bridge) {
      const owned = config.channels.filter(c => c.id === MANAGED_ID || c.id.startsWith(NATIVE_PREFIX));
      if (!owned.length) return { status: '接入已关闭' };
      if (this.deps.promaIsRunning()) return {
        status: `接入已关闭，等待 Proma 完全退出后移除 ${owned.length} 个专用渠道`,
        code: 'disconnect-pending', pendingCleanup: true, pendingChannels: owned.length,
      };
      next = { ...config, channels: config.channels.filter(c => c.id !== MANAGED_ID && !c.id.startsWith(NATIVE_PREFIX)) };
    } else {
      if (!checkOnly && this.deps.promaIsRunning()) return { status: '等待 Proma 完全退出后应用更新', count: bridge.models.length };
      const key = this.deps.loadEncryptionKey(this.state);
      let encrypted;
      try {
        const reference = existing || config.channels.find(c => c.id.startsWith(NATIVE_PREFIX) && c.apiKey) || config.channels.find(c => c.apiKey);
        if (!reference) throw new Error('请先在 Proma 保存一个渠道，以验证加密格式。');
        if (!this.deps.decryptToken(key, reference.apiKey).length) throw new Error('凭据加密验证失败。');
        encrypted = this.deps.decryptToken(key, reference.apiKey) === bridge.key
          ? reference.apiKey : this.deps.encryptToken(key, bridge.key);
      } finally { key.fill(0); }
      // Read legacy model preferences during migration, then permanently remove its channel.
      next = mergeNativeChannels(config, bridge, encrypted, Date.now(), this.options);
      next.channels = next.channels.filter(c => c.id !== MANAGED_ID);
      const withoutTimestamp = value => {
        return JSON.stringify(value.map(({ updatedAt, ...rest }) => rest));
      };
      if (withoutTimestamp(config.channels) === withoutTimestamp(next.channels)) {
        this.lastSyncedInput = fingerprint(original);
        return { status: '已同步', count: bridge.models.length };
      }
    }
    if (checkOnly) return { status: bridge ? '检查通过，有待同步的模型配置' : '检查通过，待移除专用渠道', count: bridge?.models.length };
    if (this.deps.promaIsRunning()) return bridge
      ? { status: '等待 Proma 完全退出后应用更新', count: bridge.models.length }
      : { status: '接入已关闭，等待 Proma 完全退出后清理专用渠道', code: 'disconnect-pending', pendingCleanup: true };
    if (manifestBytes && !fs.readFileSync(this.manifest).equals(manifestBytes)) return { status: '模型配置已变化，下次重试' };
    this.deps.writeConfig(this.file, original, next);
    if (bridge) this.lastSyncedInput = fingerprint(Buffer.from(`${JSON.stringify(next, null, 2)}\n`));
    const reselectRequired = config.channels.some(old => (old.id === MANAGED_ID || old.id.startsWith(NATIVE_PREFIX)) &&
      (!next.channels.some(channel => channel.id === old.id) || old.models?.some(model => !next.channels.find(channel => channel.id === old.id)?.models.some(current => current.id === model.id))));
    return { status: bridge ? '同步完成' : '专用渠道已移除', count: bridge?.models.length,
      ...(!bridge ? { removedChannels: config.channels.length - next.channels.length } : {}),
      ...(reselectRequired ? { reselectRequired: true } : {}) };
  }
}

module.exports = { SyncEngine, parseBridge, MANAGED_ID };
if (require.main === module) {
  const mode = process.argv[2];
  if (!['--check', '--remove'].includes(mode)) {
    console.error('用法：node sync-engine.cjs --check 或 --remove');
    process.exitCode = 1;
  } else new SyncEngine().tick({ checkOnly: mode === '--check', remove: mode === '--remove' }).then(result => {
    console.log(result.status);
    if (result.code) process.exitCode = 1;
    if (mode === '--remove' && result.status.includes('等待 Proma')) process.exitCode = 1;
  }).catch(() => {
    console.error('同步检查失败：请检查 Proma 初始化、配置 JSON、Local State 加密格式和同步锁。凭据不会输出。');
    process.exitCode = 1;
  });
}
