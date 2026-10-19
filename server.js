// OpenCode server entry, loaded by Magpie's Bun plugin host.
import engine from './sync-engine.cjs';
import proxy from './native-proxy.cjs';
import service from './bridge-service.cjs';
import fs from 'node:fs';
import path from 'node:path';
let started = false;

export default async function PromaBridge(input, options = {}) {
  if (started) return {};
  const sync = new engine.SyncEngine({ options });
  started = true;
  let previousStatus = '';
  let reselectRequired = false;
  const bridgeService = service.createBridgeService({
    sync,
    createProxy: proxy.startNativeProxy,
    onResult(result) {
      reselectRequired ||= result.reselectRequired === true;
      const status = JSON.stringify(result);
      if (status !== previousStatus) {
        console.log(`[Proma bridge] ${result.status}${result.count === undefined ? '' : ` (${result.count} models)`}`);
        if (result.reselectRequired) console.log('[Proma bridge] 渠道或模型 ID 已迁移，请在 Proma 重新选择模型。');
        saveStatus(sync.manifest, { ...result, reselectRequired, pluginVersion: proxy.VERSION });
        previousStatus = status;
      }
    },
    onError(error, phase) {
      if (phase === 'metadata') return; // Existing capabilities and channels remain usable.
      // Do not log exceptions from DPAPI or configuration data: they may contain secrets.
      if (previousStatus !== 'error') console.log('[Proma bridge] 同步失败，请运行 node sync-engine.cjs --check 查看检查结果。');
      saveStatus(sync.manifest, { status: '同步失败，请运行 doctor.cmd 检查', code: error.code === 'EADDRINUSE' ? 'port-in-use' : 'sync-error', pluginVersion: proxy.VERSION });
      previousStatus = 'error';
    },
  });
  await bridgeService.start();
  return {};
}

function saveStatus(manifest, status) {
  const file = path.join(path.dirname(manifest), 'magpie-status.json');
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch { /* Diagnostics must not stop synchronization. */ }
  finally { try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {} }
}
