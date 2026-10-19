'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseBridge } = require('./sync-engine.cjs');
const { refreshCapabilities } = require('./reasoning-capabilities.cjs');

// File notifications drive connection changes; polling only recovers missed events.
function createBridgeService({ sync, createProxy, refresh = refreshCapabilities, onResult = () => {}, onError = () => {}, intervalMs = 5000 }) {
  let stopped = false, dirty = false, flight, refreshing, proxyReady = false, proxyServer, timer;
  const watchers = new Map();
  const watchedFiles = [sync.manifest, sync.options.providersFile,
    path.join(path.dirname(sync.manifest), 'magpie-capabilities.json'),
    path.join(path.dirname(sync.manifest), 'magpie-model-overrides.json')].filter(Boolean);
  const directories = new Map();
  for (const file of watchedFiles) {
    const directory = path.dirname(file);
    if (!directories.has(directory)) directories.set(directory, new Set());
    directories.get(directory).add(path.basename(file));
  }

  function watchDirectories() {
    for (const [directory, names] of directories) {
      if (watchers.has(directory) || !fs.existsSync(directory)) continue;
      try {
        const watcher = fs.watch(directory, { persistent: false }, (_event, filename) => {
          if (!filename || names.has(String(filename))) requestSync();
        });
        watcher.on('error', () => { watcher.close(); watchers.delete(directory); });
        watchers.set(directory, watcher);
      } catch { /* The recovery timer retries directories created later by Magpie. */ }
    }
  }

  function refreshInBackground() {
    if (stopped || refreshing || sync.options.cleanup || !fs.existsSync(sync.manifest)) return;
    let bridge;
    try { bridge = parseBridge(JSON.parse(fs.readFileSync(sync.manifest, 'utf8').replace(/^\uFEFF/, ''))); }
    catch { return; } // A file event may arrive between two writes; the next event retries.
    if (!bridge) return;
    refreshing = Promise.resolve().then(() => refresh(bridge, sync.manifest))
      .then(result => { if (result?.refreshed) requestSync(); })
      .catch(error => onError(error, 'metadata'))
      .finally(() => { refreshing = undefined; });
  }

  function requestSync() {
    if (stopped) return Promise.resolve();
    dirty = true;
    if (flight) return flight;
    flight = (async () => {
      // Allow duplicate notifications from a single save to coalesce.
      await Promise.resolve();
      while (dirty && !stopped) {
        dirty = false;
        try {
          if (!sync.options.cleanup && !proxyReady) {
            proxyServer = await createProxy(sync.manifest, sync.options);
            proxyReady = true;
          }
          // Apply cached/Agent capabilities first. Network refresh must never delay connection.
          onResult(await sync.tick({ remove: sync.options.cleanup }));
        } catch (error) { onError(error, 'sync'); }
        watchDirectories();
        refreshInBackground();
      }
    })().finally(() => { flight = undefined; });
    return flight;
  }

  return {
    async start() {
      watchDirectories();
      timer = setInterval(requestSync, intervalMs);
      timer.unref?.();
      await requestSync();
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
      await flight;
      if (proxyServer) await new Promise(resolve => {
        proxyServer.close(resolve);
        proxyServer.closeAllConnections?.();
      });
    },
  };
}

module.exports = { createBridgeService };
