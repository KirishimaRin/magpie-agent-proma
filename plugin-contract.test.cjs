'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pkg = require('./package.json');

test('documented Bun server entry exports only a plugin function, with no auxiliary exports', async () => {
  assert.equal(pkg.type, 'module');
  const entry = pkg.exports?.['./server'] || pkg.main || pkg.exports?.['.'] || './index.js';
  assert.equal(typeof entry, 'string');
  const module = await import(entry);
  assert.deepEqual(Object.keys(module), ['default']);
  assert.equal(typeof module.default, 'function');
});

test('GitHub discovery classifies the package as Agent while the Bun service stays loadable', async () => {
  // The discovery rule checks main/exports; the runtime also checks gateway hooks and index files.
  assert.equal(pkg.main, undefined);
  assert.equal(pkg.exports, undefined);
  assert.equal(pkg.magpie.middleware, undefined);
  assert.equal(typeof pkg.magpie.agent, 'string');
  assert(fs.existsSync('./index.js'));
  const hook = await import(pkg.magpie.hooks);
  assert.deepEqual(Object.keys(hook), ['onRequest']);
  const reports = [];
  const body = { model: 'test/model', messages: [{ content: 'private-content' }] };
  const before = JSON.stringify(body);
  for (const agent of ['proma', 'codex']) {
    assert.equal(await hook.onRequest(body, { agent, report: (...args) => reports.push(args) }), undefined);
  }
  assert.equal(JSON.stringify(body), before);
  assert.deepEqual(reports, [['ready', 0], ['skipped', 0]]);
});

test('Agent contract supports client-side selection, dotted ownership and bounded sandbox code', async () => {
  const entry = pkg.magpie.agent;
  assert(fs.existsSync(entry));
  const module = await import(entry);
  assert.deepEqual(Object.keys(module).sort(), ['agent', 'connect']);
  assert.match(module.agent.id, /^[a-z0-9._-]+$/);
  assert.equal(module.agent.format, 'json');
  assert.equal(module.agent.model, undefined);
  assert.equal(typeof module.connect, 'function');
  const result = module.connect({ gateway: { url: 'http://127.0.0.1:3425', key: 'contract-test-key' }, models: [{ id: 'test/model', name: 'Test', efforts: ['low', 'high'], context: 32768, output: 1024, images: true }] });
  assert(Object.keys(result).every(key => key.startsWith('bridge.')));
  assert.equal(result['bridge.key'], 'contract-test-key');
  assert.deepEqual(result['bridge.models'][0], { id: 'test/model', name: 'Test', efforts: ['low', 'high'], context: 32768, output: 1024, images: true });
  const source = fs.readFileSync(entry, 'utf8');
  assert(!/^\s*import\b/m.test(source), 'Agent entry unexpectedly gained runtime imports');
  assert(!/\b(?:require|fetch)\s*\(/.test(source), 'Agent sandbox must delegate I/O to Magpie');
});

test('distribution has a valid plugin icon and no install/build lifecycle requirement', () => {
  assert.match(pkg.magpie.icon, /^data:image\/svg\+xml;base64,/);
  const icon = Buffer.from(pkg.magpie.icon.split(',')[1], 'base64');
  assert(icon.length < 1024 * 1024);
  assert.equal(icon.toString('utf8'), fs.readFileSync('icon.svg', 'utf8'));
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(pkg.scripts[hook], undefined);
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0);
  assert(pkg.keywords.includes('opencode'));
  assert(pkg.keywords.includes('opencode-plugin'));
});

test('npm package includes the entire runtime module closure and excludes local artifacts', () => {
  const output = process.platform === 'win32'
    ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm pack --dry-run --json'], { encoding: 'utf8', windowsHide: true })
    : execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
  const files = new Set(JSON.parse(output)[0].files.map(file => file.path));
  assert(files.has('package.json'));
  const pending = [pkg.main || './index.js', pkg.magpie.agent, pkg.magpie.hooks].filter(Boolean), visited = new Set();
  while (pending.length) {
    const file = path.posix.normalize(pending.pop());
    if (visited.has(file)) continue;
    visited.add(file);
    assert(files.has(file), `Runtime file missing from package: ${file}`);
    if (!/\.(?:c?js|mjs)$/.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\brequire\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
      pending.push(path.posix.join(path.posix.dirname(file), match[1]));
    }
  }
  assert(files.has('LICENSE'));
  assert(files.has('PRIVACY.md'));
  assert(files.has('README.md'));
  for (const file of files) assert(!/^(?:\.git\/|\.smoke\/|research\/|release\/|node_modules\/)/.test(file), file);
});
