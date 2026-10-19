# Magpie 插件规范核对

核对日期：2026-10-19。依据：[Magpie 官方插件开发文档](https://usemagpie.ai/docs/zh/plugins)。

| 文档要求 | 本项目实现 | 验证 |
| --- | --- | --- |
| 服务端入口可由 main 加载 | 根目录 package.json 指向 server.js | 导入实际模块，检查导出 |
| 入口函数接收 input/options，返回 hooks | 默认导出 async 函数，返回空 hooks 对象；后台服务在 Bun 中运行 | 隔离安装与运行测试 |
| 辅助函数不作为插件导出 | 服务端模块只有 default 导出 | plugin-contract.test.cjs |
| Agent 使用 magpie.agent 独立声明 | agent.js 导出 agent/connect | 原生 Magpie Agent 测试 |
| Agent id 合法；客户端选模时省略 model | id 为 proma，选模位于 Proma | 单元与隔离测试 |
| Agent 通过点分路径写入其他配置键 | bridge.* 键由 Magpie 管理与恢复 | connect、目录更新、恢复测试 |
| Agent 在 moejs 沙盒运行 | Agent 入口不使用 Node API、网络或外部导入 | 实际 Magpie 沙盒加载与执行 |
| Bun 安装不依赖安装脚本 | 无运行时依赖，无 install/postinstall/prepare | 包元信息检查 |
| 运行文件完整提交并可直接加载 | 源文件无需构建；发布白名单包含运行模块与 JSON 规则 | 递归检查运行依赖与安装包 |
| 插件图标采用允许格式且小于 1 MB | 内嵌 data:image/svg+xml 图标 | 解码与大小检查 |
| npm 搜索关键词包含 opencode 和 plugin 类关键词 | opencode、opencode-plugin | 包元信息检查 |
| GitHub 发现需要公开、原创、未归档仓库和 magpie-plugin topic | 源码结构已就绪；建仓时设置仓库属性与 topic | 推送后检查 GitHub 元信息及 Magpie 发现列表 |

GitHub 发现无需先发布 npm 包。社区推荐列表的 `kind: "agent"` 属于 registry.json 条目，不是本项目必须添加的 package.json 字段。

本插件同时使用官方 Agent 入口与 Bun 服务端入口：前者写桥接键，后者负责 Proma 的凭据加密、渠道合并与本机协议代理。Proma 渠道配置由服务端扩展组件维护，退出 Proma 后应用并预先备份；卸载前的清理顺序见 README。

## 可复现检查

```powershell
node --test
node smoke-magpie.cjs C:/path/to/magpie.exe
node smoke-package.cjs C:/path/to/magpie.exe auto release/magpie-agent-proma-0.5.0.tgz
```

完整包测试使用隔离的 Git 源和配置目录，验证安装、Agent 恢复、Bun 服务、DPAPI 加密及卸载。线上 GitHub 地址的安装与发现列表检查，在仓库公开推送并添加 topic 后进行。
