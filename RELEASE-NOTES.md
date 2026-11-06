## v0.1.1

Supports the native auto-review request format used by DSH 0.2.2-rc.1, while retaining the older protocol. The pending call stays last, source-labelled history remains intact, and valid denials still return immediately.

适配 DSH 0.2.2-rc.1 的原生审查请求格式，同时保留旧版协议。待审查动作仍在最后，历史记录及来源角色保持原样，合法拒绝直接返回。

Verification: 76 offline tests, 8 isolated host checks, 49 fictional cases across 11 live model routes, 15 injected-fault recovery cases, and isolated installation/removal checks passed. See [test conditions and limits](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.1/COMPATIBILITY.en.md).

验证通过：76 项离线测试、8 项独立宿主检查、11 个真实模型入口的 49 个虚构样例、15 组故障注入恢复，以及独立安装卸载检查。见[测试条件与限制](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.1/COMPATIBILITY.md)。

Install the npm package **dsh-review-format-guard@0.1.1** through DSH's plugin manager, or use the attached **dsh-review-format-guard-0.1.1.tgz**. [English installation guide](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.1/INSTALL.en.md).

通过 DSH 插件管理器安装 npm 包 **dsh-review-format-guard@0.1.1**，或使用附件 **dsh-review-format-guard-0.1.1.tgz**。[中文安装指南](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.1/INSTALL.md)。

The source ZIP is for source review; SHA256SUMS.txt verifies both archives. Formatting checks do not guarantee correct model judgment, and retries cannot restore an unavailable service.

源码 ZIP 用于查看源码，SHA256SUMS.txt 可核对两个附件。格式校验不保证模型判断正确，重试也不能恢复持续不可用的服务。

Initiated and maintained by MintMilk777, with development and testing assistance from OpenAI Codex.

由 MintMilk777 发起并维护，使用 OpenAI Codex 协助开发与测试。
