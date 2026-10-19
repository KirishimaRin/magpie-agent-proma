'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SyncEngine } = require('./sync-engine.cjs');
const { assessCompatibility } = require('./compatibility.cjs');
const { NATIVE_PREFIX } = require('./native-channels.cjs');
const { report } = require('./capability-report.cjs');

function installedOptions() {
  const file = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'magpie', 'plugins.json');
  if (!fs.existsSync(file)) return {};
  const plugins = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).plugins || [];
  const matches = plugins.filter(plugin => (path.isAbsolute(plugin.spec) && path.resolve(plugin.spec).toLowerCase() === __dirname.toLowerCase()) || /(?:^|[/\\:])magpie-agent-proma(?:\.git)?(?:[#@/]|$)/i.test(plugin.spec));
  if (matches.length > 1) throw new Error('发现多个安装记录，请用 --options 指定配置文件');
  return matches[0]?.options || {};
}

async function diagnose(engine) {
  const summary = { pluginVersion: require('./package.json').version, platform: process.platform,
    compatibility: assessCompatibility(engine.options), promaRunning: engine.deps.promaIsRunning(),
    files: { channels: fs.existsSync(engine.file), bridge: fs.existsSync(engine.manifest), localState: fs.existsSync(engine.state), lock: fs.existsSync(`${engine.file}.magpie-sync.lock`) },
    port: engine.options.port,
  };
  try {
    const c = JSON.parse(fs.readFileSync(engine.file, 'utf8').replace(/^\uFEFF/, ''));
    summary.channelSchema = c.version;
    summary.managedChannels = c.channels.filter(channel => channel.id.startsWith(NATIVE_PREFIX)).length;
  } catch { summary.channelRead = 'unavailable'; }
  try {
    const counts = {};
    for (const entry of report(engine.manifest, engine.options.providersFile)) counts[entry.status] = (counts[entry.status] || 0) + 1;
    summary.capabilityCounts = counts;
  } catch { summary.capabilityRead = 'unavailable'; }
  try {
    const status = JSON.parse(fs.readFileSync(path.join(path.dirname(engine.manifest), 'magpie-status.json'), 'utf8'));
    // An explicit allowlist keeps this report free of usernames, model names and credentials.
    summary.lastSync = { code: status.code || null, version: status.pluginVersion, updatedAt: status.updatedAt,
      reselectRequired: status.reselectRequired === true, pendingCleanup: status.pendingCleanup === true,
      pendingChannels: Number.isInteger(status.pendingChannels) ? status.pendingChannels : 0,
    };
  } catch { summary.lastSync = null; }
  try { summary.check = await engine.tick({ checkOnly: true }); }
  catch { summary.check = { code: 'check-failed', status: '请检查配置 JSON、覆盖规则、加密格式及同步锁' }; }
  return summary;
}

function restore(engine, backup) {
  const absolute = path.resolve(backup || '');
  if (path.dirname(absolute) !== path.dirname(engine.file) || !path.basename(absolute).startsWith('channels.json.magpie-backup-')) throw new Error('请选择同目录的 channels.json.magpie-backup-* 文件');
  const bytes = fs.readFileSync(absolute);
  const config = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (!Number.isInteger(config.version) || config.version < 2 || !Array.isArray(config.channels)) throw new Error('备份格式无效');
  engine.deps.writeConfig(engine.file, fs.readFileSync(engine.file), config);
  return { status: '已恢复备份；请保持 Agent 接入关闭后打开 Proma' };
}

module.exports = { installedOptions, diagnose, restore };
if (require.main === module) (async () => {
  const args = process.argv.slice(2), index = args.indexOf('--options');
  let options;
  if (index !== -1) {
    options = JSON.parse(fs.readFileSync(args[index + 1], 'utf8').replace(/^\uFEFF/, ''));
    args.splice(index, 2);
  } else options = installedOptions();
  const engine = new SyncEngine({ options });
  const action = args[0];
  if (action === 'doctor') console.log(JSON.stringify(await diagnose(engine), null, 2));
  else if (action === 'cleanup') {
    if (!fs.existsSync(engine.file)) { console.log('没有 Proma 渠道文件，无需清理'); return; }
    const result = await engine.tick({ remove: true });
    console.log(result.status);
    if (result.status.includes('等待')) process.exitCode = 1;
  } else if (action === 'restore') console.log(restore(engine, args[1]).status);
  else throw new Error('用法：plugin-tools.cjs doctor | cleanup | restore <备份路径> [--options <配置文件>]');
})().catch(() => { console.error('操作失败：请检查选项、退出 Proma 后重试；恢复备份前请先关闭 Agent 接入。'); process.exitCode = 1; });
