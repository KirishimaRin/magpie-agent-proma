'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('PowerShell 5 installer waits for GUI Magpie and supports repeat installs with spaces', {
  skip: process.platform !== 'win32' || !process.env.MAGPIE_TEST_EXE,
}, () => {
  fs.mkdirSync('.smoke', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.smoke/installer test-'));
  const plugin = path.join(root, 'plugin with spaces');
  fs.mkdirSync(plugin);
  fs.copyFileSync('install.ps1', path.join(plugin, 'install.ps1'));
  fs.copyFileSync('agent.js', path.join(plugin, 'agent.js'));
  fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: 'installer-test-proma', version: '0.0.0', magpie: { agent: './agent.js' } }));
  const env = { ...process.env, MAGPIE_EXE: process.env.MAGPIE_TEST_EXE, XDG_CONFIG_HOME: path.join(root, 'config'), MAGPIE_NO_ACCOUNTS: '1', DO_NOT_TRACK: '1' };
  for (let i = 0; i < 2; i++) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(plugin, 'install.ps1')], {
      env, encoding: 'utf8', windowsHide: true, timeout: 30000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'magpie', 'plugins.json'), 'utf8'));
    assert.equal(config.plugins.filter(p => p.spec === plugin).length, 1);
  }
});
