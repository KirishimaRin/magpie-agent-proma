# Magpie Agent 插件：Proma

把 Magpie 已配置的供应商、订阅模型和路由组接入 Proma。Magpie 中出现 Proma Agent，开启接入后，模型目录持续同步到 Proma 的专用渠道，模型在 Proma 内选择。

基于 [官方插件开发文档](https://usemagpie.ai/docs/zh/plugins) 的 **Agent 插件**与 **OpenCode 服务端入口**，当前版本 `0.4.0`。支持 Windows；已验证本机 Magpie `0.1.1290` 和 Proma `0.19.58` 的配置加密格式。

## 安装与使用

1. 把此文件夹放在固定位置，例如 `E:\Project\Proma-magpie`。
2. 在 Magpie → 插件 → 添加插件，输入文件夹路径；也可双击 `install.cmd`。Magpie 首次使用服务端插件时会自行准备 Bun。
3. 在 Magpie → Agent 中找到 **Proma**，开启接入。模型在 Proma 内选择，因此此行只有连接开关。
4. 从托盘完全退出 Proma，等待约 5 秒，再打开。
5. 新建 Proma 会话，选择 **Magpie · 供应商 · 协议或模型名** 下的模型。0.3.1 自动删除旧的 **Magpie 本机** 全模型渠道，后续同步不再创建它。

供应商模型或可见模型列表变化后，Magpie 再次调用 `connect()`，同步组件每 5 秒检查桥接配置。Proma 正在运行时等待；完全退出后应用，随后重新打开即可看到新列表。无变化时不重复写配置或生成备份。

同步保留其他渠道、默认模型选择、已有模型的显示名称和启用状态。新模型默认启用，消失的模型从插件专用渠道移出。可用 Magpie 的 Agent 模型可见性功能管理同步范围。

## 思考强度（0.3.0）

旧渠道统一使用 Anthropic 协议和 `provider/model` ID，Proma 的原生能力规则匹配不到很多模型。新版增加原生模型渠道：

| 模型 | 协议 | 使用方式 |
| --- | --- | --- |
| GPT / o 系列 | OpenAI Responses | Agent 使用 Pi；匹配原生思考档位 |
| Claude、Kimi、GLM、DeepSeek | Anthropic Messages | 匹配 Proma 原生能力规则 |
| Gemini | Google | Gemini 原生思考设置；Agent 使用 Pi |
| Grok、MiMo、MiniMax、Step | OpenAI Chat | 采用 Proma/Pi 目录中该模型已有的能力 |

认证代理监听 `127.0.0.1:3426`，把 Proma 使用的原生 ID 转回完整 Magpie ID。供应商由渠道 URL 精确区分。reasoning、thinking、output_config、generationConfig、工具调用和流式响应原样转发；质量检测插件的错误也原样返回。

Proma 0.19.58 尚未识别 GPT-6.1，所以插件对 `gpt-6.1-sol` 使用本地 `gpt-6-astra` 能力别名，显示 low/medium/high/xhigh/max；名称仍显示 GPT-6.1，发往 Magpie 的 ID 仍是原始 `供应商/gpt-6.1-sol`。DeepSeek V4.1 Flash 使用 V4 Flash 的协议能力别名；免费 GLM 等后缀也在本地整理。实际模型 ID 保存在 `magpieModelId` 中；别名独占渠道以避免与同供应商的其他模型混淆。

可显示档位使用当前 Proma 的能力表；0.4.0 为缺失菜单的模型增加下述自动模板匹配。升级后完全退出 Proma，在 Magpie 关闭再开启本插件，并从托盘退出、重启 Magpie 以加载新代理；等待同步后重开 Proma，改选原生渠道。旧会话若仍引用已删除的全模型渠道，请重新选择原生渠道中的模型。

### 路由组（0.3.2）

每个路由组有自己的「Magpie · 路由组 · 组名」渠道。插件只读 Magpie `providers.json` 的成员关系，包括嵌套组；未写入文件的自动组按 Magpie 自动组 ID 与目录模型的精确 slug 匹配能力族。成员属于相同能力族时使用对应原生 ID、协议和思考档位。混合模型、未知能力或循环成员配置使用通用 OpenAI Chat 渠道。

实际请求的模型始终是 `group/组ID`，由 Magpie 自行执行顺序、轮询、智能选择等已有规则。成员配置变化后持续同步目录。删除过的 54 模型总渠道保持删除。

## 自动匹配思考能力（0.4.0）

插件保留已识别模型的原生接入，对缺失菜单的模型按能力数据选择现有 Proma 模板，无需修改 Proma 安装文件。

数据优先级：Magpie `/v1/models` 的 `reasoning_levels` → Agent 目录的 `efforts` → models.dev `reasoning_options`。Magpie 明确返回空档位时保持该声明；`reasoning: true` 本身只说明模型具备推理能力。

模板包括 GPT-6 Astra（low/medium/high/xhigh/max）、GLM-5.3（low/high/max）、Gemini 3.1 Pro（low/medium/high）、Gemini 3 Flash（minimal/low/medium/high）。只选择菜单全部档位都受供应商支持的模板，优先覆盖更多档位。原生菜单没有的 ultra 等额外档位，以及没有可匹配模板的组合，列在能力报告中；不把档位改名或偷偷降级。

例如 Step 的 low/medium/high 对应 Gemini 菜单模板；界面名称和实际供应商模型仍是 Step。代理向 Magpie 的 Google 协议入口发送 Step 的完整真实 ID，由 Magpie 处理协议转换。路由组始终发送 group/组ID。

Magpie 目录每 5 分钟刷新，models.dev 每 24 小时刷新。新目录 ID 触发提前检查；失败使用已有缓存并限制重试频率。缓存为 `~/.proma/magpie-capabilities.json`，只含模型能力，不含接入 Key；访问 models.dev 不发送本机配置或凭据。

```powershell
node capability-report.cjs
```

报告显示每个模型的目录档位、数据来源、匹配模板和暂未覆盖档位。更新配置后请重新选择对应模型；使用 Google/Responses 渠道的 Agent 会话选择 Pi。

## Git 基线与回退

第一次提交 `e944a62` 保存 v0.3.2，标签为 `baseline-v0.3.2`。新功能在 `feature/dynamic-reasoning` 分支，`main` 保持基线。

回退时先退出 Proma，在 Magpie 关闭本插件，然后执行：

```powershell
git switch main
```

再开启插件，从托盘退出并重启 Magpie，等待同步后打开 Proma。重新测试新功能使用 `git switch feature/dynamic-reasoning`，同样重启 Magpie 加载插件。切换前保持工作区干净；现有配置修改前仍会自动备份。

## 两个入口的分工

- `agent.js`：官方 `magpie.agent` 入口，在 moejs 沙盒内运行，没有 Node API。`connect({gateway, models})` 按点分键路径写入 `~/.proma/magpie-bridge.json`。Magpie 负责专用 Key、模型变更通知和桥接配置恢复。
- `server.js`：官方 OpenCode 服务端函数入口，在 Magpie 的 Bun 插件宿主内启动 `native-proxy.cjs` 并定时调用 `sync-engine.cjs`，处理原生模型路由、渠道合并和本机凭据加密。

两个入口打包在同一个插件中，无需额外的开机任务、后台服务或供应商。Proma 使用渠道数组和 Electron 加密字段，因此先经过桥接配置，再合并进渠道文件。

只有 Magpie 插件宿主运行时才会持续同步；退出 Magpie 后同步和本机代理随之停止。Proma 会话访问模型时需要 Magpie 网关运行。

## 持续更新

**模型目录**自动同步，流程见上文。

**插件代码**使用 Magpie 官方 npm/Git 更新机制。源码无需构建，无安装脚本和第三方依赖。

本地开发：修改本文件夹，关闭再开启插件，重新加载代码。

长期维护：把本项目作为仓库根目录推送到自己的 GitHub 仓库，按分支安装：

```text
magpie plugin add github:YOUR_ACCOUNT/YOUR_REPOSITORY#main
magpie plugin update
```

占位地址替换成实际仓库。Magpie 检测分支新提交并提示更新。也可选定 npm 包名后发布；每次发布递增 `package.json` 版本并更新 `CHANGELOG.md`。

按官方文档，普通 npm/Git 插件有更新提示，点击更新或运行 `magpie plugin update` 应用；`@magpie-community/*` 才享有文档所述的自动代码升级。本项目当前保存在本机，尚未发布到远程。

`.github/workflows/ci.yml` 在 Windows 上运行测试和打包检查。发布前执行：

```powershell
node --test
npm pack --dry-run
npm pack
```

npm 发布前选定自己拥有的包名、补齐仓库信息并确定许可证。当前 `UNLICENSED` 保留代码发布许可决定。

## 配置与恢复

- 渠道：`%USERPROFILE%\.proma\channels.json`
- 桥接：`%USERPROFILE%\.proma\magpie-bridge.json`
- Electron 密钥：`%APPDATA%\@proma\electron\Local State`
- 原生渠道 ID 前缀：`magpie-proma-native-`；迁移会删除旧渠道 `magpie-proma-agent-v1`
- 请求：本机网关的 `/v1/messages`，类型 `anthropic-compatible`

专用 Agent Key 由 Magpie 提供；供应商真实 API Key 留在 Magpie。桥接文件含本机接入 Key，应与配置一起留在本机。同步组件读取 Electron 的 DPAPI 加密密钥，用 AES-GCM 加密接入 Key，并先验证已有渠道的凭据格式。至少先在 Proma 保存一个渠道，供首次验证。

每次修改前保存 `channels.json.magpie-backup-*`，加独占同步锁，再检查 Proma 进程及配置变化，最后原子替换。恢复时完全退出 Proma，把选定备份复制回 `channels.json`。

若系统异常退出后留下 `channels.json.magpie-sync.lock`，先退出 Magpie 和 Proma，确认无同步进程，再删除该锁文件并重开 Magpie。

## 关闭与卸载

在 Agent 页关闭 Proma 接入，保持插件开启。Proma 退出后，同步组件移除自己的专用渠道。

本地安装可先退出 Proma，再双击 `uninstall.cmd`。Git/npm 安装请先在 Agent 页关闭接入，待专用渠道移除后，再在插件页删除插件。直接关闭或删除整个插件会同时停止同步组件，已有的 Proma 专用渠道可手动删除。

## 检查

```powershell
# 无写入检查，需 Node.js 22+；正常插件运行使用 Magpie 自带 Bun
node sync-engine.cjs --check

# 临时目录中的单元和文件写入测试
node --test

# 实际 Magpie 的隔离测试
node smoke-magpie.cjs C:\path\to\magpie.exe
```

隔离测试使用项目内 `.smoke` 配置目录，验证安装、注册、连接、模型目录更新和恢复。测试桥接文件也在 `.smoke` 下。

安装后在 Proma 发送简短消息，再要求读取一个项目文件，可验证所选供应商的对话和工具调用。测试脚本不发送模型推理请求。

早期独立导入工具 `sync.cmd` / `magpie-proma.cjs --apply` 保留作手动备选，使用另一渠道 ID，不参加插件自动同步。

## 参考

- [官方插件开发文档](https://usemagpie.ai/docs/zh/plugins)
- [Magpie Agent 插件运行时](https://github.com/yetone/magpie/blob/main/internal/agentplug/agentplug.go)
- [Proma 渠道与凭据加密](https://github.com/proma-ai/Proma/blob/main/apps/electron/src/main/lib/channel-manager.ts)
- [Proma 请求地址处理](https://github.com/proma-ai/Proma/blob/main/packages/core/src/providers/url-utils.ts)
