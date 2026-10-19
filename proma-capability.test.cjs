// Optional check against the installed Proma capability table. No application code is patched.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { nativeModel } = require('./native-channels.cjs');
const { TEMPLATES } = require('./reasoning-capabilities.cjs');

test('installed Proma recognizes reasoning profiles after native routing', { skip: !process.env.PROMA_TEST_ASAR }, () => {
  const fd = fs.openSync(process.env.PROMA_TEST_ASAR, 'r');
  let code;
  try {
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    const json = Buffer.alloc(header.readUInt32LE(12));
    fs.readSync(fd, json, 0, json.length, 16);
    const file = JSON.parse(json).files.dist.files['main.cjs'];
    const source = Buffer.alloc(file.size);
    fs.readSync(fd, source, 0, source.length, 8 + header.readUInt32LE(4) + Number(file.offset));
    code = source.toString('utf8');
  } finally { fs.closeSync(fd); }
  function section(start, end) {
    const a = code.indexOf(start), b = code.indexOf(end, a + start.length);
    assert(a >= 0 && b > a, 'Proma bundle layout changed; review the capability adapter.');
    return code.slice(a, b);
  }
  const family = section('// ../../packages/shared/src/utils/model-family.ts', '// ../../packages/shared/src/types/agent.ts');
  const reasoning = section('// ../../packages/shared/src/types/reasoning-profile.ts', '// ../../packages/shared/src/types/agent-provider.ts');
  const context = vm.createContext({});
  vm.runInContext('function __esm(m){let done=false;return()=>{if(!done){done=true;Object.values(m)[0]()}}};' + family + reasoning + ';init_reasoning_profile();this.profile=resolveReasoningProfile;', context, { timeout: 1000 });
  for (const id of ['codex/gpt-6.1-sol', 'codex/gpt-6-luna', 'workbuddy-ai/kimi-k3', 'workbuddy-ai/glm-5.3', 'workbuddy-ai/deepseek-v4.1-flash']) {
    const native = nativeModel({ id });
    const transport = native.protocol === 'responses' ? 'openai-responses' : 'anthropic-messages';
    assert.equal(context.profile({ modelId: id, transport }), undefined);
    const profile = context.profile({ modelId: native.id, transport });
    assert(profile?.levels.includes('high'), `${id} has no high reasoning option`);
    assert(profile?.levels.length > 1);
  }
  for (const template of TEMPLATES.filter(t => t.protocol !== 'google')) {
    const profile = context.profile({ modelId: template.id, transport: template.protocol === 'responses' ? 'openai-responses' : 'anthropic-messages' });
    assert.deepEqual(Array.from(profile.levels), template.levels);
  }
  const gemini = section('// ../../packages/shared/src/utils/gemini-model-capabilities.ts', '\n// ../../packages/shared/src/');
  vm.runInContext(gemini + ';init_gemini_model_capabilities();this.gemini=getGeminiModelCapability;', context, { timeout: 1000 });
  for (const template of TEMPLATES.filter(t => t.protocol === 'google')) {
    assert.deepEqual(Array.from(context.gemini(template.id).thinkingLevels), template.levels);
  }
});
