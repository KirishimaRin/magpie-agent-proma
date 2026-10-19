'use strict';
const path = require('node:path');
const os = require('node:os');
function runtimeOptions(options = {}, { home = os.homedir(), appData = process.env.APPDATA || '' } = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('插件选项必须是对象');
  const port = options.port ?? 3426;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('port 必须是 1024–65535 的整数');
  for (const key of ['promaDirectory', 'localStatePath', 'promaExecutable', 'bridgeFile', 'providersFile']) {
    if (options[key] !== undefined && (typeof options[key] !== 'string' || !path.isAbsolute(options[key]))) throw new Error(`${key} 必须是绝对路径`);
  }
  for (const key of ['allowUntestedProma', 'cleanup']) if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
  return {
    port, origin: `http://127.0.0.1:${port}`, cleanup: options.cleanup === true,
    promaDirectory: options.promaDirectory || path.join(home, '.proma'),
    localStatePath: options.localStatePath || path.join(appData, '@proma', 'electron', 'Local State'),
    bridgeFile: options.bridgeFile || path.join(home, '.proma', 'magpie-bridge.json'),
    providersFile: options.providersFile || path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'magpie', 'providers.json'),
    promaExecutable: options.promaExecutable, allowUntestedProma: options.allowUntestedProma === true,
  };
}
module.exports = { runtimeOptions };
