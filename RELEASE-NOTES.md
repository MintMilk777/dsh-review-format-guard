## v0.1.3

Auto-review requests now make it clearer that the final tool-call record is the action awaiting a decision. Stream errors identify fixed causes such as a missing conclusion, conflicting snapshots, or a missing finish event. Verified whitespace-only blocks around a verdict are removed so the response can be read by DSH's native parser.

本次明确了待审查动作的边界，减少模型把当前调用误当作历史的情况；流错误会区分结论缺失、前后内容冲突、缺少结束信号等原因。确认仅含空白的内容块会整体移除，避免合法结论仍被 DSH 原生解析器拒绝。

The original policy, history, source roles, arguments, and valid denials are preserved. Retry limits and waiting defaults are unchanged. Checked on Windows / DSH 0.2.2-rc.3 with 185 offline tests and 18 host checks. See [test scope](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.3/COMPATIBILITY.en.md).

原规则、历史、来源角色、参数和合法拒绝继续保留，重试次数与等待默认值不变。在 Windows / DSH 0.2.2-rc.3 上完成 185 项离线测试和 18 项宿主检查。详见[测试范围](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.3/COMPATIBILITY.md)。

Install **`dsh-review-format-guard@0.1.3`** through DSH's plugin manager, or download **`dsh-review-format-guard-0.1.3.tgz`** below. The source archive is **`dsh-review-format-guard-source-v0.1.3.zip`**; checksums are in **`SHA256SUMS.txt`**. [English installation guide](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.3/INSTALL.en.md).

在 DSH 插件管理器中安装 **`dsh-review-format-guard@0.1.3`**，或下载下方 **`dsh-review-format-guard-0.1.3.tgz`**。源码附件为 **`dsh-review-format-guard-source-v0.1.3.zip`**，校验值见 **`SHA256SUMS.txt`**。[中文安装指南](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.3/INSTALL.md)。

Initiated and maintained by MintMilk777, with development and testing assistance from OpenAI Codex.

由 MintMilk777 发起并维护，使用 OpenAI Codex 协助开发与测试。
