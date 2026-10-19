# 数据与权限

本插件作为 Magpie 的 Bun 插件运行，能读写当前用户文件并启动 PowerShell。它不替用户注册供应商账户。

- 读取 Magpie 为 Proma Agent 提供的可见模型和专用本机 Key；供应商 API Key 由 Magpie 管理。
- 读取 Magpie providers.json 的路由组成员关系。
- 读取 Proma channels.json 和 Electron Local State，通过 Windows DPAPI 取得本机加密材料，用于验证和保存专用渠道 Key。
- 读取 Proma app.asar 的 package.json 来识别版本，保持安装文件原样。
- 自动发现的安装位置记在桥接目录的 magpie-installation.json，便于退出 Proma 后继续检查；该本机路径不进入诊断报告。
- 写入专用桥接、能力缓存、状态文件和 Proma 专用渠道；每次修改渠道前保留本机备份。
- 本机代理仅监听 127.0.0.1，要求 Agent Key；携带浏览器 Origin 的请求被拒绝。请求、工具数据和响应转发至本机 Magpie。
- 异步请求钩子只按 Agent 标识上报固定的 ready/skipped 状态；钩子不读取正文，也不改写请求。
- 从 https://models.dev/api.json 获取公开能力目录。该请求不发送用户模型列表、本机路径、对话或凭据。目录失败时保留已有缓存。
- doctor.cmd 输出版本、状态和计数；能力详细报告会列出用户模型名称与 ID，分享前自行检查。

channels.json、magpie-bridge.json、Local State 及渠道备份包含凭据或加密材料，请留在本机。Git 和发布包仅包含源码白名单；不收集遥测，不记录请求正文或 Key。

关闭 Agent 接入会恢复 Agent 所管理的桥接键；保持插件运行并退出 Proma后清理其专用渠道。卸载和恢复步骤见 README。
