# DSH Review Format Guard

[English](README.md) · [安装与卸载](INSTALL.md) · [排查问题](docs/TROUBLESHOOTING.md) · [兼容与测试](COMPATIBILITY.md)

这个插件为 DeepSeek Harness（DSH）的原生自动审查补上一层返回格式检查和有限重试。

部分第三方中转服务会在 DSH 等待审查结论时，返回普通文字、代码框、工具调用标记或不完整的 JSON，导致工具还没执行，审查就报错。插件处理其中能明确识别的格式问题，也让失败原因更容易排查。

## 安装

在 DSH 插件页面填写 **`dsh-review-format-guard@0.1.3`**。普通 `dsh web` 部署可以运行：

```sh
dsh plugin --profile web add dsh-review-format-guard@0.1.3 --ignore-scripts
```

桌面版自带命令、本地安装包、更新与卸载步骤见[安装指南](INSTALL.md)。预构建安装包也可从 [Releases](https://github.com/MintMilk777/dsh-review-format-guard/releases/tag/v0.1.3) 下载。

按提示重启，确认插件已启用，会话仍处于“自动审查”模式。可以先试一句“只查看当前工作目录，不修改文件”。

## 它做了什么？

- 跨服务商和模型路由识别已支持的原生审查请求。
- 明确最后一条工具调用记录就是当前待审查动作，保留原规则、历史、来源角色和参数。
- 检查完整返回；可清理包住整个结论的 JSON 代码框、外围空白、开头的字节顺序标记，以及确认整块都为空白的内容块。
- 对缺失、畸形或冲突结果有限重试；合法拒绝直接交回 DSH，不为取得允许而重试。
- 区分结论缺失、前后内容冲突、意外动作块、缺少结束信号等错误。日志保留固定分类和耗时，不记录会话或回复原文。

插件通过 DSH 的标准插件接口挂载，授权规则和权限设置仍由 DSH 管理。

## 等待和失败处理

默认每次尝试总期限为 180 秒，首个有效内容最多等 120 秒，开始后连续 30 秒没有新有效内容就结束。最多三次尝试，最坏约九分钟，再加重试间隔。用户显式设置的数值继续生效。

取消、认证失败、额度耗尽，以及已识别的请求无效或上下文过长错误不重试。资源超限最多共尝试两次，并受重试设置限制。完整行为见[排查说明](docs/TROUBLESHOOTING.md)和[技术说明](docs/TECHNICAL.md)。

多次尝试仍得不到合法结果，审查就继续失败。插件不会从普通文字、思考过程或工具调用标记里截取一个“允许”。

## 兼容范围

本轮在 Windows / DSH **0.2.2-rc.3** 上核验，识别 rc.1–rc.3 使用的多消息审查协议，同时保留旧版四栏目协议。安装不按 DSH 版本号范围拦截；运行时不认识的规则或请求结构会原样转发。

具体范围见[兼容与测试](COMPATIBILITY.md)。格式正确不代表授权判断一定正确，重试也不能恢复上游不提供的模型。

## 开发与反馈

使用 Node.js 22.19.0 或更新版本，从源码目录运行 `npm test`。离线测试无需安装依赖、配置 API 密钥或安装 DSH。可选宿主检查见[贡献指南](CONTRIBUTING.md)。

反馈问题请到 [Issues](https://github.com/MintMilk777/dsh-review-format-guard/issues)，先去掉密钥和私人内容。

由 MintMilk777 发起并维护，使用 OpenAI Codex 协助开发与测试。

[MIT 许可](LICENSE)。源码测试快照保留 [DeepSeek 的 MIT 声明](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.3/fixtures/LICENSE.deepseek)。
