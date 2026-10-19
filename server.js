// OpenCode server entry, loaded by Magpie's Bun plugin host.
import engine from './sync-engine.cjs';
import proxy from './native-proxy.cjs';
import capabilities from './reasoning-capabilities.cjs';
import fs from 'node:fs';
import path from 'node:path';
let started = false;

export default async function PromaBridge(input, options = {}) {
  if (started) return {};
  const sync = new engine.SyncEngine({ options });
  started = true;
  let previousStatus = '';
  let busy = false;
  let proxyServer;
  let reselectRequired = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (!sync.options.cleanup) proxyServer ||= await proxy.startNativeProxy(sync.manifest, sync.options);
      if (!sync.options.cleanup && fs.existsSync(sync.manifest)) {
        const bridge = engine.parseBridge(JSON.parse(fs.readFileSync(sync.manifest, 'utf8').replace(/^\uFEFF/, '')));
        await capabilities.refreshCapabilities(bridge, sync.manifest);
      }
      const result = await sync.tick({ remove: sync.options.cleanup });
      reselectRequired ||= result.reselectRequired === true;
      const status = JSON.stringify(result);
      if (status !== previousStatus) {
        console.log(`[Proma bridge] ${result.status}${result.count === undefined ? '' : ` (${result.count} models)`}`);
        if (result.reselectRequired) console.log('[Proma bridge] 渠道或模型 ID 已迁移，请在 Proma 重新选择模型。');
        saveStatus(sync.manifest, { ...result, reselectRequired, pluginVersion: proxy.VERSION });
        previousStatus = status;
      }
    } catch (error) {
      // Do not log exceptions from DPAPI or configuration data: they may contain secrets.
      if (previousStatus !== 'error') console.log('[Proma bridge] 同步失败，请运行 node sync-engine.cjs --check 查看检查结果。');
      saveStatus(sync.manifest, { status: '同步失败，请运行 doctor.cmd 检查', code: error.code === 'EADDRINUSE' ? 'port-in-use' : 'sync-error', pluginVersion: proxy.VERSION });
      previousStatus = 'error';
    } finally {
      busy = false;
    }
  };
  await tick();
  const timer = setInterval(tick, 5000);
  timer.unref?.();
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
