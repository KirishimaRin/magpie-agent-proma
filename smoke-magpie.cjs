// Optional integration test against the user's installed Magpie, in a separate config directory.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const binary = process.argv[2];
if (!binary || !fs.existsSync(binary)) throw new Error('Usage: node smoke-magpie.cjs <absolute path to magpie.exe>');
fs.mkdirSync(path.resolve('.smoke'), { recursive: true });
const root = fs.mkdtempSync(path.resolve('.smoke/native-agent-'));
const target = path.join(root, 'bridge.json').replaceAll('\\', '/');
const plugin = path.join(root, 'plugin');
fs.mkdirSync(plugin, { recursive: true });
fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: 'magpie-agent-proma-smoke', version: '0.0.0', type: 'module', magpie: { agent: './agent.js' } }));
fs.writeFileSync(path.join(plugin, 'agent.js'), fs.readFileSync('agent.js', 'utf8').replace("'~/.proma/magpie-bridge.json'", JSON.stringify(target)));
const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, 'config'), MAGPIE_NO_ACCOUNTS: '1', DO_NOT_TRACK: '1' };
function cli(args) {
  const result = spawnSync(binary, args, { env, encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Magpie smoke command failed: ${args.slice(0, 2).join(' ')}: ${result.error?.message || result.stderr}`);
  return result.stdout;
}
cli(['plugin', 'add', plugin]);
assert.match(cli(['proma', '--help']), /fields: provider/);
cli(['provider', 'add', 'smoke', 'chat=http://127.0.0.1:1/v1', 'key=dummy-test-key', 'models=first,second']);
cli(['proma', 'provider', 'magpie']);
const bridge = JSON.parse(fs.readFileSync(target, 'utf8'));
assert.equal(bridge.bridge.version, 1);
assert(bridge.bridge.models.some(m => m.id === 'smoke/first'));
assert(bridge.bridge.models.some(m => m.id === 'smoke/second'));
assert(bridge.bridge.key.length > 0);
cli(['provider', 'models', 'smoke', 'first', 'second', 'third']);
cli(['proma', 'provider', 'magpie']);
const updated = JSON.parse(fs.readFileSync(target, 'utf8'));
assert(updated.bridge.models.some(m => m.id === 'smoke/third'));
cli(['proma', 'default']);
const restored = JSON.parse(fs.readFileSync(target, 'utf8'));
assert(!restored.bridge?.key);
console.log('Native Magpie smoke passed: install, Agent registration, connect(), catalog updates, key ownership, and restore.');
