// Full package test: isolated Git source, Magpie Agent lifecycle, Bun host and real Windows encryption.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { encryptToken, promaIsRunning } = require('./magpie-proma.cjs');

async function main() {
  const binary = process.argv[2], tarball = process.argv[4];
  let bun = process.argv[3];
  if (![binary, tarball].every(file => file && fs.existsSync(file)) || (bun !== 'auto' && (!bun || !fs.existsSync(bun)))) throw new Error('Usage: node smoke-package.cjs <magpie.exe> <bun.exe|auto> <package.tgz>');
  if (promaIsRunning()) throw new Error('Exit Proma before this integration test');
  fs.mkdirSync('.smoke', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.smoke/full-package-'));
  execFileSync('tar', ['-xf', path.resolve(tarball), '-C', root], { windowsHide: true });
  const plugin = path.join(root, 'magpie-agent-proma'), manifest = path.join(root, 'magpie-bridge.json');
  fs.renameSync(path.join(root, 'package'), plugin);
  const key = crypto.randomBytes(32);
  const protectedKey = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))'], {
    input: key.toString('base64'), encoding: 'utf8', windowsHide: true,
  }).trim();
  const state = path.join(root, 'Local State');
  fs.writeFileSync(state, JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), Buffer.from(protectedKey, 'base64')]).toString('base64') } }));
  const other = { id: 'untouched', apiKey: encryptToken(key, 'dummy-test-token'), enabled: true, models: [] };
  const channels = path.join(root, 'channels.json');
  fs.writeFileSync(channels, JSON.stringify({ version: 12, channels: [other], keep: true }));
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const options = { port, promaDirectory: root, bridgeFile: manifest, localStatePath: state,
    providersFile: path.join(root, 'config', 'magpie', 'providers.json'), allowUntestedProma: true };
  fs.renameSync(path.join(plugin, 'server.js'), path.join(plugin, 'server-impl.js'));
  fs.writeFileSync(path.join(plugin, 'server.js'), `import bridge from './server-impl.js'; export default async(input,options)=>bridge(input,${JSON.stringify(options)});`);
  const isolatedPackage = JSON.parse(fs.readFileSync(path.join(plugin, 'package.json')));
  isolatedPackage.files.push('server-impl.js');
  fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify(isolatedPackage));
  fs.writeFileSync(path.join(plugin, 'agent.js'), fs.readFileSync(path.join(plugin, 'agent.js'), 'utf8')
    .replace("'~/.proma/magpie-bridge.json'", JSON.stringify(manifest.replaceAll('\\', '/')))
    .replace("'~/.proma'", JSON.stringify(root.replaceAll('\\', '/'))));
  function command(exe, args, settings = {}) {
    const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 60000, windowsHide: true, ...settings });
    if (r.error || r.status !== 0) throw new Error(`Isolated command failed: ${args[0]} (${r.status}) ${r.error?.message || r.stderr?.slice(0, 500)}`);
    return r.stdout;
  }
  command('git', ['init', '-b', 'main', plugin]);
  command('git', ['-C', plugin, 'add', '.']);
  command('git', ['-C', plugin, '-c', 'user.name=Package Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'isolated package']);
  const spec = 'git+' + pathToFileURL(plugin.replaceAll('\\', '/') + '/').href;
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, 'config'), MAGPIE_NO_ACCOUNTS: '1', DO_NOT_TRACK: '1', BUN_INSTALL_CACHE_DIR: path.join(root, 'bun-cache') };
  const cli = args => command(binary, args, { env });
  cli(['plugin', 'add', spec]);
  cli(['plugin', 'options', spec, JSON.stringify(options)]);
  const installedProject = path.join(root, 'config', 'magpie', 'plugins');
  const dependencies = JSON.parse(fs.readFileSync(path.join(installedProject, 'package.json'))).dependencies;
  assert.equal(Object.keys(dependencies || {}).length, 1, 'Expected one isolated Git dependency');
  const installedEntry = path.join(installedProject, 'node_modules', Object.keys(dependencies)[0], 'index.js');
  assert(fs.existsSync(installedEntry), 'Installed Git package server entry missing');
  if (bun === 'auto') {
    const base = path.join(process.env.XDG_CACHE_HOME || path.join(require('node:os').homedir(), '.cache'), 'magpie', 'bun');
    bun = fs.readdirSync(base).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map(version => path.join(base, version, 'magpie-bun.exe')).find(file => fs.existsSync(file));
    assert(bun, 'Magpie bundled Bun missing after Git package installation');
  }
  assert.match(cli(['proma', '--help']), /fields: provider/);
  cli(['provider', 'add', 'smoke', 'chat=http://127.0.0.1:1/v1', 'key=dummy-test-key', 'models=gpt-6.1-sol,step-5-preview']);
  fs.writeFileSync(manifest, '{}');
  // The Bun host is started explicitly so its lifetime is controlled by this test.
  const host = spawn(bun, ['-e', `import plugin from ${JSON.stringify(pathToFileURL(installedEntry).href)}; await plugin({},{}); await new Promise(()=>{});`], {
    env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Consume output without retaining or printing private config data.
  host.stdout.resume(); host.stderr.resume();
  try {
    // Start disconnected, then connect while the Bun service is already running.
    // This catches the real reconnect/startup path rather than only initial import.
    const statusFile = path.join(root, 'magpie-status.json');
    const readyDeadline = Date.now() + 10000;
    while (!fs.existsSync(statusFile) && Date.now() < readyDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert(fs.existsSync(statusFile), 'Packaged host did not start while disconnected');
    const connectedAt = Date.now();
    cli(['proma', 'provider', 'magpie']);
    const bridge = JSON.parse(fs.readFileSync(manifest)).bridge;
    assert(bridge.models.some(model => model.id === 'smoke/gpt-6.1-sol'));
    let config;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      config = JSON.parse(fs.readFileSync(channels));
      if (config.channels.some(channel => channel.id.startsWith('magpie-proma-native-'))) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(config.channels.some(channel => channel.id.startsWith('magpie-proma-native-')), 'Packaged Bun host did not sync isolated channels');
    console.log(`Connected channels ready after ${Date.now() - connectedAt} ms, including Magpie CLI connection.`);
    assert.deepEqual(config.channels.find(channel => channel.id === 'untouched'), other);
    const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: 'Bearer ' + bridge.key }, signal: AbortSignal.timeout(3000) });
    assert.equal((await response.json()).version, require('./package.json').version);
    cli(['proma', 'default']);
    const cleanupDeadline = Date.now() + 12000;
    while (Date.now() < cleanupDeadline && JSON.parse(fs.readFileSync(channels)).channels.length !== 1) await new Promise(resolve => setTimeout(resolve, 250));
    assert.deepEqual(JSON.parse(fs.readFileSync(channels)).channels, [other]);
    host.kill();
    command('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(plugin, 'install.ps1'), '-Action', 'Remove'], { env: { ...env, MAGPIE_EXE: binary, MAGPIE_BUN_EXE: bun } });
    const installed = JSON.parse(fs.readFileSync(path.join(root, 'config', 'magpie', 'plugins.json')));
    assert(!installed.plugins.some(entry => entry.spec === spec));
    console.log('Full package smoke passed: Git distribution, Agent connect/restore, bundled Bun host, DPAPI channels, health, cleanup and uninstaller.');
  } finally { host.kill(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
