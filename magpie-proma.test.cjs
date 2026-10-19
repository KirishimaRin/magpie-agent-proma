'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mergeChannel, encryptToken, decryptToken, CHANNEL_ID } = require('./magpie-proma.cjs');

test('preserves unrelated channels and config; repeated sync updates one owned channel', () => {
  const other = { id: 'other', apiKey: 'opaque', models: [{ id: 'keep' }] };
  const initial = { version: 5, channels: [other], futureField: { keep: true } };
  const once = mergeChannel(initial, ['a', 'b'], 'encrypted', 1);
  once.channels[1].models[0].enabled = false;
  once.channels[1].models[0].name = 'My name';
  const twice = mergeChannel(once, ['a', 'c'], 'encrypted2', 2);
  assert.deepEqual(twice.channels[0], other);
  assert.deepEqual(twice.futureField, initial.futureField);
  assert.equal(twice.channels.filter(c => c.id === CHANNEL_ID).length, 1);
  assert.deepEqual(twice.channels[1].models.map(m => [m.id, m.enabled]), [['a', false], ['c', true]]);
  assert.equal(twice.channels[1].models[0].name, 'My name');
  assert.equal(twice.channels[1].createdAt, 1);
  assert.equal(initial.channels.length, 1);
});

test('rejects old/invalid schema instead of rewriting it', () => {
  for (const config of [null, {}, { version: 1, channels: [] }, { version: 5, channels: null }]) {
    assert.throws(() => mergeChannel(config, ['a'], 'key'));
  }
});

test('AES-GCM tokens round trip and reject tampering', () => {
  const key = crypto.randomBytes(32);
  const encrypted = encryptToken(key);
  assert.equal(decryptToken(key, encrypted), 'magpie');
  const corrupt = Buffer.from(encrypted, 'base64');
  corrupt[20] ^= 1;
  assert.throws(() => decryptToken(key, corrupt.toString('base64')));
  assert.throws(() => decryptToken(crypto.randomBytes(32), encrypted));
});
