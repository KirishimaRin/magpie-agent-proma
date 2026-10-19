# Magpie Agent 插件：Proma

让 Proma 使用 Magpie 已配置的供应商、订阅模型与路由组，并为缺少识别规则的模型自动匹配原生思考菜单。每个用户的模型和能力都从自己的 Magpie 获取。

当前版本 **0.5.0**，Windows x64，MIT。已验证 Proma 0.19.58、渠道 schema 5/7/12；Magpie 本地测试版本 0.1.1290 / 0.1.1293。运行插件使用 Magpie 自带 Bun，开发测试使用 Node.js 22+。

## 安装

GitHub 发布后，在 Magpie → 插件 → 添加插件输入：

```text
github:KirishimaRin/magpie-agent-proma#main
```

或执行：

```powershell
magpie plugin add github:KirishimaRin/magpie-agent-proma#main
```

本地使用：把本文件夹放在固定位置，在插件页添加其路径，或双击 install.cmd。已有本地安装时避免重复添加 GitHub 安装；先按卸载步骤移除旧安装。

1. 启用插件，在 Magpie → Agent 找到 **Proma** 并开启接入。
2. Proma 中至少保存过一个渠道，用于验证本机加密格式。
3. 从托盘完全退出 Proma，等待同步后重新打开。
4. 选择 **Magpie · 供应商 · 协议或模型名**，路由组在 **Magpie · 路由组 · 组名** 中。使用 Google/Responses 渠道的 Agent 会话选择 Pi。
5. 菜单别名显示与实际调用模型分开管理；界面仍保留真实名称，请求始终发给真实供应商/模型或 group/组ID。

模型可见性变化由 Magpie 通知 Agent，插件每 5 秒检查桥接配置。Proma 正在运行时等候，退出后自动应用。插件不自动终止其他用户的 Proma 会话。旧的“Magpie 本机”全模型渠道会被移除。

## 思考强度

能力优先级：用户手动覆盖 → Magpie reasoning_levels → Agent efforts → models.dev reasoning_options。Magpie 能力每 5 分钟刷新，models.dev 每 24 小时刷新；目录变化提前检查，网络失败保留已有缓存。

对 Proma 缺失原生菜单的模型，按真实档位匹配 capability-rules.json 中的模板；现有模板包括 GPT-6 Astra、GLM-5.3、Gemini 3.1 Pro、Gemini 3 Flash。仅展示模板与供应商共同支持的菜单档位。未匹配组合和额外档位可通过详细能力报告查看：

```powershell
node capability-report.cjs
```

[兼容性与私有模型覆盖](docs/COMPATIBILITY.md)介绍版本范围、模板列表和手动覆盖方式。菜单别名可能影响 Proma 自行推断的其他模型默认能力，具体范围也列在该文档中。

## 选项

在 Magpie 的插件选项中设置 JSON。所有路径必须是绝对路径，下面的路径仅作格式示例：

```json
{
  "port": 3426,
  "promaExecutable": "D:/Apps/Proma/Proma.exe",
  "allowUntestedProma": false
}
```

| 选项 | 默认或用途 |
| --- | --- |
| port | 3426，只监听 127.0.0.1；冲突时换端口并退出 Proma 等待同步 |
| promaExecutable | 自动发现 Proma；便携版可手动指定 |
| promaDirectory | 用户目录下 .proma；控制 channels.json 的位置 |
| localStatePath | APPDATA/@proma/electron/Local State |
| providersFile | Magpie 配置目录下 providers.json |
| bridgeFile | 用户目录下 .proma/magpie-bridge.json；自定义 Agent 配置时才改，需双方一致 |
| allowUntestedProma | false；显式开启可测试其他版本，仍须通过格式与凭据检查 |
| cleanup | false；设为 true 进入只清理专用渠道的模式，保持插件开启直到清理完成 |

未知 Proma 版本默认暂停同步并提示。bridgeFile 的位置由 Agent 声明决定；单独改服务端选项不会迁移 Agent 的写入位置。

## 诊断

双击 doctor.cmd 或 check.cmd，输出不含用户路径、私有模型名和凭据的诊断摘要。工具优先使用现有 Node，也可使用 Magpie 已下载的 Bun；需要指定时设置 MAGPIE_BUN_EXE。

```powershell
node plugin-tools.cjs doctor
node plugin-tools.cjs doctor --options C:/path/to/options.json
```

同步状态保存在桥接文件同目录的 magpie-status.json。模型迁移时日志提示在 Proma 重新选择模型。提交问题时附诊断输出、版本和复现步骤，不上传 channels.json、桥接文件、Local State 或备份。

## 更新与回退

```powershell
magpie plugin update
```

普通 GitHub 插件按分支提交提示更新，用户点击更新或执行命令应用。更新后重启 Magpie，退出 Proma 等待同步，再重新打开；旧会话引用被迁移的渠道或模型时重新选择。模型自定义名称与启用状态按真实模型 ID 尽量迁移，其他渠道保持原样。

首次工作区快照为 e944a62，标签 baseline-v0.3.2；思考强度首版为 421a546，标签 baseline-v0.4.0。main 为发布分支。源码回退时先关闭 Agent 接入、退出 Proma 并停止 Magpie，然后执行：

```powershell
git switch --detach baseline-v0.3.2
```

重启 Magpie 并恢复 Agent 接入，等待同步后打开 Proma。恢复新版使用 git switch main。工作区须保持干净。

## 关闭、卸载与恢复

**只关闭接入：**在 Agent 页关闭 Proma 接入，保持插件开启；退出 Proma，等待专用渠道被移除。

**卸载：**退出 Proma，运行插件目录的 uninstall.cmd。脚本先恢复 Agent 桥接键，再清理专用渠道，最后移除插件。GitHub 安装也可按“关闭接入 → 等待清理 → 插件页删除”的顺序操作。完成后重启 Magpie。直接删除整个插件会同时停掉清理组件；遗留渠道可重新安装后清理，或在 Proma 手动删除 Magpie 专用渠道。

每次写入前生成 channels.json.magpie-backup-*，加独占锁并再次检查进程和文件变化。恢复前关闭 Agent 接入、退出 Proma，将所需备份拖到 restore.cmd 上；恢复操作会先备份当前配置。亦可使用：

```powershell
node plugin-tools.cjs restore C:/path/to/channels.json.magpie-backup-...
```

异常退出留下同步锁时，退出 Magpie 和 Proma，确认同步进程结束，再删除 channels.json.magpie-sync.lock。备份包含加密凭据，应留在本机。

## 开发与发布

```powershell
node --test
node smoke-magpie.cjs C:/path/to/magpie.exe
npm run release
```

发布包在 release/，包括 ZIP、TGZ 和 SHA256 校验文件。CI 验证单元测试、打包和官方 Proma 菜单；v版本号标签触发 Release。详见[发布流程](docs/RELEASING.md)和[变更记录](CHANGELOG.md)。

早期 sync.cmd / magpie-proma.cjs --apply 为独立导入备选，会创建另一旧式渠道；日常使用请选择 Agent 插件。

## 数据与实现

agent.js 通过官方 Agent API 写桥接键；server.js 在 Magpie 的 Bun 宿主中运行认证代理与同步组件。请求和流式响应经 127.0.0.1 转发至 Magpie，质量检测错误原样返回。供应商 API Key 由 Magpie 管理。本插件读取本机 Electron 加密材料来保存接入 Key，权限与联网范围见[隐私说明](PRIVACY.md)。

- [Magpie 官方插件文档](https://usemagpie.ai/docs/zh/plugins)
- [Proma 项目](https://github.com/proma-ai/Proma)
- [models.dev 能力目录](https://models.dev/api.json)
