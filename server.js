// OpenCode server entry, loaded by Magpie's Bun plugin host.
import engine from './sync-engine.cjs';
import proxy from './native-proxy.cjs';
import capabilities from './reasoning-capabilities.cjs';
import fs from 'node:fs';
let started = false;

export default async function PromaBridge() {
  if (started) return {};
  started = true;
  const sync = new engine.SyncEngine();
  let previousStatus = '';
  let busy = false;
  let proxyServer;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      proxyServer ||= await proxy.startNativeProxy(sync.manifest);
      if (fs.existsSync(sync.manifest)) {
        const bridge = engine.parseBridge(JSON.parse(fs.readFileSync(sync.manifest, 'utf8').replace(/^\uFEFF/, '')));
        await capabilities.refreshCapabilities(bridge, sync.manifest);
      }
      const result = await sync.tick();
      const status = JSON.stringify(result);
      if (status !== previousStatus) {
        console.log(`[Proma bridge] ${result.status}${result.count === undefined ? '' : ` (${result.count} models)`}`);
        previousStatus = status;
      }
    } catch {
      // Do not log exceptions from DPAPI or configuration data: they may contain secrets.
      if (previousStatus !== 'error') console.log('[Proma bridge] 同步失败，请运行 node sync-engine.cjs --check 查看检查结果。');
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
