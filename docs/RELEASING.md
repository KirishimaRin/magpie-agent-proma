# 发布与验证

目标仓库：https://github.com/KirishimaRin/magpie-agent-proma

1. 在干净工作区更新 package.json 版本、CHANGELOG 和兼容规则。
2. 运行 `node --test`，并设置 `PROMA_TEST_ASAR` 对照安装的 Proma 验证模板；设置 `MAGPIE_TEST_EXE` 验证隔离安装脚本。
3. 运行 `node smoke-magpie.cjs <magpie.exe绝对路径>` 验证原生 Agent 生命周期。构建包后、退出 Proma，运行 `node smoke-package.cjs <magpie.exe> auto release/magpie-agent-proma-<版本>.tgz` 验证完整 Git 分发、Bun 宿主、真实 DPAPI 加密及渠道清理。所有测试数据放在被忽略的 .smoke 中。
4. 运行 `npm run release`，检查 release 下 ZIP、TGZ 与 SHA256SUMS.txt。包按 package.json 的 files 白名单生成，不包含本机账户、研究文件或测试目录。
5. 将通过检查的提交合并到 main；保留 baseline-v0.3.2、baseline-v0.4.0 标签供回退。
6. 推送 main 后，先确认 CI 和官方 Proma 兼容性检查通过，再打 `v<package.json版本>` 标签并推送。Release 工作流重新测试、校验版本与标签、构建并创建 GitHub Release。

GitHub 仓库添加 `magpie-plugin` topic；根目录保留 package.json 和直接可加载的运行文件。插件图标内嵌在 package.json，无需外部图床。

从其他目录或机器验证真正的 GitHub 分发安装：

```powershell
magpie plugin add github:KirishimaRin/magpie-agent-proma#main
magpie plugin update
```

首次远程发布前，该仓库地址尚未有可安装代码，远程安装验证应在仓库推送后执行。每个用户的 Magpie 模型由其本机发现，不随仓库发布。

普通 GitHub 插件按分支提交检查更新；固定 commit 不提示更新。社区包的自动更新方式见 Magpie 官方文档。加入社区推荐列表时按 `kind: "agent"` 提交条目，当前不冒用 @magpie-community 命名空间。

CI 的普通测试独立运行；兼容性 job 下载 SHA256 固定的官方 Proma 0.19.58 Debian 发行包，仅解压资源，不安装应用，不使用个人凭据。官方资源布局变化应先检查脚本再修改规则。初次发布后应检查 Actions 的完整结果。
