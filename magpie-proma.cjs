#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const CHANNEL_ID = 'magpie-proma-local-v1';
const GATEWAY = 'http://127.0.0.1:3425';
const ENDPOINT = `${GATEWAY}/v1/messages`;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function mergeChannel(config, modelIds, encryptedKey, now = Date.now(), options = {}) {
  const channelId = options.channelId || CHANNEL_ID;
  if (!config || !Number.isInteger(config.version) || config.version < 2 || !Array.isArray(config.channels)) {
    throw new Error('不支持的 Proma 配置格式，请先使用新版 Proma 完成初始化。');
  }
  const matches = config.channels.filter(c => c.id === channelId);
  if (matches.length > 1) throw new Error('专用渠道 ID 重复，请先修复配置。');
  const existing = matches[0];
  const previous = new Map((existing?.models || []).map(m => [m.id, m]));
  const models = modelIds.map(id => ({
    ...previous.get(id), id,
    name: previous.get(id)?.name || id,
    enabled: previous.get(id)?.enabled ?? true,
    source: 'fetched',
  }));
  const channel = {
    ...existing,
    id: channelId,
    name: existing?.name || 'Magpie 本机',
    provider: 'anthropic-compatible',
    baseUrl: options.endpoint || ENDPOINT,
    apiKey: encryptedKey,
    models,
    enabled: true,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  return {
    ...config,
    channels: existing
      ? config.channels.map(c => c.id === channelId ? channel : c)
      : [...config.channels, channel],
  };
}

async function fetchModelIds() {
  const response = await fetch(`${GATEWAY}/v1/models`, {
    headers: { Authorization: 'Bearer magpie' },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Magpie 模型列表请求失败：HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.data)) throw new Error('Magpie 返回了无效的模型列表。');
  const ids = [...new Set(body.data.map(m => m?.id).filter(id => typeof id === 'string' && id.trim()))];
  if (!ids.length) throw new Error('Magpie 模型列表为空，请先配置供应商。');
  return ids;
}

function promaIsRunning() {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "if (Get-Process -Name Proma -ErrorAction SilentlyContinue) { 'running' }"],
  { encoding: 'utf8', windowsHide: true });
  return output.includes('running');
}

function loadEncryptionKey(localStateFile) {
  const encoded = readJson(localStateFile).os_crypt?.encrypted_key;
  if (typeof encoded !== 'string') throw new Error('Proma Local State 中缺少加密密钥。');
  const blob = Buffer.from(encoded, 'base64');
  if (blob.subarray(0, 5).toString() !== 'DPAPI') throw new Error('不支持的 Electron 加密格式。');
  const command = [
    'Add-Type -AssemblyName System.Security',
    '$blob=[Convert]::FromBase64String([Console]::In.ReadToEnd())',
    '$key=[Security.Cryptography.ProtectedData]::Unprotect($blob,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Convert]::ToBase64String($key))',
  ].join(';');
  const key = Buffer.from(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    input: blob.subarray(5).toString('base64'), encoding: 'utf8', windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim(), 'base64');
  if (key.length !== 32) throw new Error('Electron 加密密钥长度异常。');
  return key;
}

function encryptToken(key, token = 'magpie') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('v10'), iv, ciphertext, cipher.getAuthTag()]).toString('base64');
}

function decryptToken(key, encoded) {
  const blob = Buffer.from(encoded, 'base64');
  if (blob.subarray(0, 3).toString() !== 'v10' || blob.length < 31) throw new Error('不支持的凭据格式。');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(3, 15));
  decipher.setAuthTag(blob.subarray(-16));
  return UTF8.decode(Buffer.concat([decipher.update(blob.subarray(15, -16)), decipher.final()]));
}

function writeConfig(file, original, config, { isRunning = promaIsRunning } = {}) {
  const lock = `${file}.magpie-sync.lock`;
  const lockFd = fs.openSync(lock, 'wx', 0o600);
  try {
  if (isRunning()) throw new Error('请先从系统托盘完全退出 Proma，再双击同步；工具不会强制关闭你的会话。');
  if (!fs.readFileSync(file).equals(original)) throw new Error('配置已被其他进程修改，请重新同步。');
  const backup = `${file}.magpie-backup-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (isRunning()) throw new Error('Proma 已启动，稍后再同步。');
    if (!fs.readFileSync(file).equals(original)) throw new Error('写入前检测到配置变化，已停止。');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return backup;
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check', '--apply'].includes(args[0])) {
    throw new Error('用法：node magpie-proma.cjs --check 或 --apply');
  }
  if (process.platform !== 'win32') throw new Error('当前版本支持 Windows。');
  const file = path.join(os.homedir(), '.proma', 'channels.json');
  const state = path.join(process.env.APPDATA || '', '@proma', 'electron', 'Local State');
  const original = fs.readFileSync(file);
  const config = JSON.parse(original.toString('utf8').replace(/^\uFEFF/, ''));
  const ids = await fetchModelIds();
  const key = loadEncryptionKey(state);
  let encrypted;
  try {
    // Authenticate compatibility against an actual saved credential without displaying it.
    const reference = config.channels.find(c => c.apiKey);
    if (!reference) throw new Error('请先在 Proma 保存一个渠道，以便验证凭据加密格式。');
    if (!decryptToken(key, reference.apiKey).length) throw new Error('已有凭据为空。');
    encrypted = encryptToken(key);
    if (decryptToken(key, encrypted) !== 'magpie') throw new Error('凭据加密自检失败。');
  } finally {
    key.fill(0);
  }
  const next = mergeChannel(config, ids, encrypted);
  console.log(`Magpie 已连接，可同步 ${ids.length} 个模型。`);
  console.log('Proma 凭据加密格式验证通过。');
  if (args[0] === '--check') {
    console.log(`检查完成，未修改配置。Proma 当前${promaIsRunning() ? '正在运行' : '已退出'}。`);
    return;
  }
  const backup = writeConfig(file, original, next);
  console.log(`同步成功。备份：${backup}`);
  console.log('现在打开 Proma，在新会话的模型菜单选择「Magpie 本机」。');
}

module.exports = { mergeChannel, fetchModelIds, encryptToken, decryptToken, writeConfig, loadEncryptionKey, promaIsRunning, CHANNEL_ID };
if (require.main === module) main().catch(error => {
  console.error(`操作失败：${error.message}`);
  process.exitCode = 1;
});
