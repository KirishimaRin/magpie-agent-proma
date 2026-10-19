'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseBridge } = require('./sync-engine.cjs');
const { nativeModel, enrichGroups } = require('./native-channels.cjs');
const { enrichCapabilities, knownNativeMenu } = require('./reasoning-capabilities.cjs');

function report(manifest = path.join(os.homedir(), '.proma', 'magpie-bridge.json'), providersFile) {
  const bridge = enrichCapabilities(enrichGroups(parseBridge(JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''))), providersFile), manifest);
  if (!bridge) return [];
  return bridge.models.map(model => {
    const native = nativeModel(model);
    const actual = model.capability?.levels || [];
    return {
      model: model.id,
      name: model.name,
      capabilitySource: model.capability?.source || 'unknown',
      providerLevels: actual,
      status: native?.reasoningTemplate ? 'dynamic-template' : native && knownNativeMenu(native) ? 'native-menu' : actual.length > 1 ? 'no-matching-template' : 'no-adjustable-levels',
      ...(native?.reasoningTemplate ? { template: native.reasoningTemplate, menuLevels: native.templateLevels, additionalProviderLevels: actual.filter(level => !native.templateLevels.includes(level)) } : {}),
    };
  });
}

module.exports = { report };
if (require.main === module) {
  try { console.log(JSON.stringify(report(), null, 2)); }
  catch { console.error('读取能力报告失败，请先开启 Proma 接入并等待目录刷新。'); process.exitCode = 1; }
}
