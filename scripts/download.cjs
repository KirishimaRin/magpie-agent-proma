'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
async function download(url, target, expected) {
  if (!/^https:\/\//.test(url) || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Expected HTTPS URL and SHA256');
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (fs.existsSync(target) && digest(target) === expected) return;
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  const temporary = `${target}.download`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok || !response.body) throw new Error(`Download HTTP ${response.status}`);
    const hash = crypto.createHash('sha256'); let length = 0;
    const verify = new Transform({ transform(chunk, encoding, done) {
      length += chunk.length;
      if (length > 512 * 1024 * 1024) return done(new Error('Artifact exceeds limit'));
      hash.update(chunk); done(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), verify, fs.createWriteStream(temporary));
    if (hash.digest('hex') !== expected) throw new Error('Artifact SHA256 mismatch');
    fs.renameSync(temporary, target);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
module.exports = { download };
if (require.main === module) download(...process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
