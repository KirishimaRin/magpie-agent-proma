# 配置、诊断与恢复

在 Magpie 的插件选项中设置 JSON。所有路径必须是绝对路径。下面的安装路径是格式示例，请替换为自己的实际路径：

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

bridgeFile 的位置由 Agent 声明决定；单独改服务端选项不会迁移 Agent 的写入位置。测试其他 Proma 版本前请阅读[兼容说明](COMPATIBILITY.md)。

## 诊断

双击 doctor.cmd 或 check.cmd，输出不含用户路径、私有模型名和凭据的诊断摘要。工具使用现有 Node.js 22+ 或 Magpie 已下载的 Bun；需要指定时设置 MAGPIE_BUN_EXE。

```powershell
node plugin-tools.cjs doctor
node plugin-tools.cjs doctor --options C:/path/to/options.json
```

同步状态保存在桥接文件同目录的 magpie-status.json。详细能力报告使用 `node capability-report.cjs`，该报告会列出本机模型名称与 ID。

## 清理渠道与卸载

在 Agent 页关闭 Proma 接入，保持插件启用；退出 Proma 后同步组件移除专用渠道。之后在插件页删除插件并重启 Magpie。

uninstall.cmd 按“恢复 Agent 桥接键 → 清理渠道 → 删除插件”执行。清理失败会保留插件安装，便于排查和重试。直接删除整个插件会同时停掉清理组件；可重新安装后清理，或在 Proma 手动删除 Magpie 专用渠道。

## 备份恢复

每次写入前生成 channels.json.magpie-backup-*，加独占锁并再次检查进程和文件变化。恢复前关闭 Agent 接入、退出 Proma，将所需备份拖到 restore.cmd 上；恢复操作会先备份当前配置。

```powershell
node plugin-tools.cjs restore C:/path/to/channels.json.magpie-backup-...
```

异常退出留下同步锁时，退出 Magpie 和 Proma，确认同步进程结束，再删除 channels.json.magpie-sync.lock。配置和备份含凭据或加密材料，请留在本机。

早期 sync.cmd / magpie-proma.cjs --apply 为独立导入备选，会创建另一旧式渠道；日常使用请选择 Agent 插件。
