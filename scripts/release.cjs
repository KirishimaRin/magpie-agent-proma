'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const pkg = require('../package.json');
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(pkg.version)) throw new Error('Invalid release version');
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${pkg.version}`) throw new Error('Tag must equal package version');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'release');
fs.mkdirSync(directory, { recursive: true });
const result = process.platform === 'win32'
  ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm pack --json --pack-destination release'], { cwd: root, encoding: 'utf8', windowsHide: true })
  : execFileSync('npm', ['pack', '--json', '--pack-destination', 'release'], { cwd: root, encoding: 'utf8' });
const packed = JSON.parse(result)[0];
const tarball = path.join(directory, packed.filename);
const staging = fs.mkdtempSync(path.join(directory, 'package-'));
// Extract only the npm whitelist, keeping development fixtures and local data out.
execFileSync('tar', ['-xf', tarball, '-C', staging], { windowsHide: true });
const zip = path.join(directory, `${pkg.name}-${pkg.version}.zip`);
if (process.platform !== 'win32') throw new Error('Create ZIP releases on Windows');
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  'Compress-Archive -LiteralPath $env:PROMA_RELEASE_SOURCE -DestinationPath $env:PROMA_RELEASE_ZIP -Force'], {
  env: { ...process.env, PROMA_RELEASE_SOURCE: path.join(staging, 'package'), PROMA_RELEASE_ZIP: zip }, windowsHide: true,
});
const sums = [tarball, zip].map(file => `${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.basename(file)}`).join('\n');
fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), sums + '\n');
console.log(sums);
