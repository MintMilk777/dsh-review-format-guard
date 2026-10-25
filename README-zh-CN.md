# DSH Review Format Guard

[English](README.md) · [安装与卸载](INSTALL.md) · [排查问题](docs/TROUBLESHOOTING.md) · [测试范围](COMPATIBILITY.md)

这个插件为 DeepSeek Harness（DSH）的原生自动审查补上一层返回格式检查和有限重试。

部分第三方中转服务会在 DSH 等待审批 JSON 时，返回普通文字、代码框、工具调用标记或不完整的 JSON，导致工具尚未执行，自动审查就报错。本插件针对这类格式问题提供兼容处理。

## 什么情况适合试用？

如果工具还没执行，就遇到下面这些错误，可以试试：

```text
Auto review of tool "working_directory" failed; its body was not executed
Unexpected token ... is not valid JSON
REVIEW_JSON_INVALID
Review response is not one complete JSON object
```

插件会检查完整返回，清理少量能明确识别的外围格式，并对不合格结果有限重试。合法拒绝会直接交回 DSH；多次尝试仍不合格，就继续报错，不会拼凑一个“允许”。

## 安装

在 DSH 插件页面安装 **`dsh-review-format-guard`**。普通 `dsh web` 部署可以运行：

```sh
dsh plugin --profile web add dsh-review-format-guard --ignore-scripts
```

桌面版自带命令、本地安装包与卸载步骤见[安装指南](INSTALL.md)。也可以从 [Releases](https://github.com/MintMilk777/dsh-review-format-guard/releases/tag/v0.1.0) 下载预构建的 `.tgz` 安装包。

按提示重启，确认插件已启用，会话仍处于“自动审查”模式。先试一句“只查看当前工作目录，不修改文件”。

## 它做了什么？

- 默认不按服务商或模型名称限制，只识别已核对的原生审查政策和请求结构。
- 保留原政策与完整待审数据，在数据后重申同一政策，帮助兼容对系统消息处理不当的服务。
- 收完返回后再检查，只接受完整且符合原生字段规则的结论。
- 可清理包住整个结论的 JSON 代码框、外围空白、开头的字节顺序标记，以及已核对的思考过程外围空白差异。不会从普通文字、思考过程或工具调用里寻找并截取“允许”。
- 默认最多尝试三次，部分临时服务错误也可重试。每次默认最多等待 60 秒，有些错误会提前结束。

它通过标准插件接口挂载，不替换内置审查组件，也不改变服务地址或权限。

## 兼容范围

**实测版本：** Windows 上的 DSH `0.2.1-rc.3`。

**理论上可能适用：** `0.2.1-alpha.2`、`alpha.3`、`alpha.4`、`alpha.5`、`rc.1` 和 `rc.2`。这些版本的自动审查源文件与 `rc.3` 完全相同，但尚未逐个做安装实测。

安装不受 DSH 版本号范围限制。运行时不认识的审查政策或请求结构会原样交回 DSH，插件不会处理这些请求。

实测范围和官方源码依据见[兼容说明](COMPATIBILITY.md)。

## 使用中要知道的事

格式正确不代表判断正确。重试可能增加耗时和费用，也不能恢复持续不可用的服务。认证失败、合法拒绝、工具执行后报错，需要分别排查。

插件自己的日志只记录诊断码和计数，不记录会话原文、凭据或模型回复；DSH 与服务端的日志由它们各自管理。

不再需要时，在 DSH 中停用，或按[卸载步骤](INSTALL.md#卸载)移除。反馈问题请到 [Issues](https://github.com/MintMilk777/dsh-review-format-guard/issues)，并先去掉密钥和私人内容。

## 开发与测试

从源码目录运行 `npm test`，可执行 51 项离线测试，无需 API 密钥、DSH 或远端模型。宿主检查见[贡献指南](CONTRIBUTING.md)，实现细节见[技术说明](docs/TECHNICAL.md)。

由 MintMilk777 发起并维护，使用 OpenAI Codex 协助开发与测试。

[MIT 许可](LICENSE)。测试快照保留 [DeepSeek 的 MIT 声明](fixtures/LICENSE.deepseek)。
