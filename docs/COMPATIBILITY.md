# 兼容性与能力规则

当前运行平台：Windows x64。插件使用 Magpie 自带 Bun；开发测试使用 Node.js 22+。

| 项目 | 已验证范围 | 检查方法 |
| --- | --- | --- |
| Proma | 0.19.58，渠道 schema 5/7/12，Electron DPAPI/v10 | 读取 app.asar/package.json；CI 读取官方发行包中的真实菜单实现；写入前验证已有凭据 |
| Magpie | 本地 0.1.1290 / 0.1.1293 | 隔离 Agent 安装、connect、目录变更、恢复测试 |
| 菜单模板 | capability-rules.json 内四种模板 | proma-capability.test.cjs 对照实际应用资源验证全部档位 |

插件自动从正在运行的 Proma、Windows 卸载注册表或常见安装目录发现安装位置。便携版未找到时，在 Magpie 的插件选项中填写 `promaExecutable` 的绝对路径。未知版本默认暂停自动写入，并通过日志、doctor.cmd 提示。`allowUntestedProma: true` 可允许用户测试其他版本；渠道格式仍须是已验证的 schema 5/7/12，凭据仍须通过解密验证。

添加已验证版本时，更新 `capability-rules.json` 和官方发行包校验脚本，再执行兼容性测试。模板规则随插件版本发布；models.dev 更新只刷新模型元数据。

能力发现顺序：用户显式覆盖 → Magpie reasoning_levels → Agent efforts → models.dev reasoning_options。Magpie 明确给出空档位时，保持其声明。models.dev 按完整或标准模型 ID 精确匹配；不同供应商的能力差异取共同档位。

插件仅选择所有菜单档位都在真实能力列表中的模板。真实模型和路由组 ID 保持原路由；Google/Responses 渠道的 Agent 使用 Pi。未覆盖档位组合可运行 `node capability-report.cjs` 查看。

## 手动覆盖私有模型

在桥接文件同目录创建 `magpie-model-overrides.json`，使用完整供应商/模型 ID：

```json
{
  "version": 1,
  "models": {
    "your-provider/private-model": {
      "levels": ["low", "medium", "high"],
      "template": "gemini-3.1-pro"
    }
  }
}
```

省略 template 时自动匹配；指定模板时校验声明档位是否覆盖模板。只填写供应商实际支持的档位。修改后退出 Proma，等待同步并重新选择模型。恢复自动发现时删除对应模型项。

Agent 传入的真实 context/output/images 保存在插件模型元数据中。当前 Proma 的运行时仍可能根据菜单别名推断上下文、输出上限和视觉能力；这些属性的完整覆盖需 Proma 提供相应扩展接口。菜单兼容别名的用途是接入思考档位。
