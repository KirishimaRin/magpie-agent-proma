'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { testedPromaVersions } = require('./capability-rules.json');

// Read a single packaged resource; never execute or modify application code.
function readAsarFile(archive, segments) {
  const fd = fs.openSync(archive, 'r');
  try {
    const header = Buffer.alloc(16);
    if (fs.readSync(fd, header, 0, 16, 0) !== 16) throw new Error('Invalid ASAR header');
    const length = header.readUInt32LE(12);
    if (length < 2 || length > 16 * 1024 * 1024) throw new Error('Invalid ASAR index');
    const index = Buffer.alloc(length);
    if (fs.readSync(fd, index, 0, length, 16) !== length) throw new Error('Truncated ASAR index');
    let entry = JSON.parse(index);
    for (const part of segments) entry = entry?.files?.[part];
    if (!entry || entry.unpacked || entry.link || !Number.isSafeInteger(entry.size) || entry.size > 32 * 1024 * 1024) throw new Error('Unsupported ASAR resource');
    const offset = 8 + header.readUInt32LE(4) + Number(entry.offset);
    if (!Number.isSafeInteger(offset) || offset < 16 + length || offset + entry.size > fs.fstatSync(fd).size) throw new Error('Invalid ASAR resource offset');
    const bytes = Buffer.alloc(entry.size);
    if (fs.readSync(fd, bytes, 0, bytes.length, offset) !== bytes.length) throw new Error('Truncated ASAR resource');
    return bytes.toString('utf8');
  } finally { fs.closeSync(fd); }
}

let discovered, discoveredAt = 0;
function discoverExecutable() {
  if (Date.now() - discoveredAt < 30000) return discovered;
  discoveredAt = Date.now();
  if (process.platform !== 'win32') return undefined;
  try {
    const script = "$p=Get-Process Proma -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -First 1 -ExpandProperty Path; if(-not $p){$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -eq 'Proma'} | ForEach-Object {Join-Path $_.InstallLocation 'Proma.exe'} | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1}; if($p){[Console]::Out.Write($p)}";
    discovered = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim() || undefined;
  } catch { discovered = undefined; }
  const common = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Proma', 'Proma.exe');
  if (!discovered && fs.existsSync(common)) discovered = common;
  return discovered;
}

const versions = new Map();
function assessCompatibility({ promaExecutable, allowUntestedProma = false, bridgeFile, rememberInstallation = false } = {}) {
  const hintFile = bridgeFile && path.join(path.dirname(bridgeFile), 'magpie-installation.json');
  let hint;
  try { hint = hintFile && JSON.parse(fs.readFileSync(hintFile, 'utf8')).executable; } catch {}
  const executable = promaExecutable || discoverExecutable() || (typeof hint === 'string' && path.isAbsolute(hint) ? hint : undefined);
  let version;
  try {
    if (executable) {
      const archive = path.join(path.dirname(executable), 'resources', 'app.asar');
      const stat = fs.statSync(archive);
      const stamp = `${archive}:${stat.mtimeMs}:${stat.size}`;
      version = versions.get(stamp);
      if (!version) {
        version = JSON.parse(readAsarFile(archive, ['package.json'])).version;
        if (typeof version !== 'string') throw new Error('Missing version');
        versions.clear(); versions.set(stamp, version);
      }
    }
  } catch { version = undefined; }
  const tested = testedPromaVersions.includes(version);
  if (version && hintFile && rememberInstallation && hint !== executable) {
    const temporary = `${hintFile}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(hintFile), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify({ executable }), { mode: 0o600 });
      fs.renameSync(temporary, hintFile);
    } catch {} finally { try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {} }
  }
  return { ok: tested || allowUntestedProma === true, code: tested ? 'tested' : version ? 'untested-version' : 'version-unknown',
    version: version || null, testedVersions: testedPromaVersions,
    message: tested ? `Proma ${version} 已验证` : version ? `Proma ${version} 尚未验证；请查看兼容说明` : '未找到 Proma 版本，请配置 promaExecutable',
  };
}

module.exports = { readAsarFile, assessCompatibility };
