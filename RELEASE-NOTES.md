## v0.1.0

A DSH plugin for auto-review failures caused by malformed JSON responses, including responses from some third-party API gateways. It checks the complete result, removes limited formatting wrappers, and retries invalid responses. Valid denials return immediately; exhausted retries remain a failure.

用于改善 DSH 自动审查因返回格式不合格而报错的问题，包括部分中转服务未按要求返回严格 JSON 的情况。插件检查完整结论、清理有限格式包装，并对不合格返回有限重试；合法拒绝直接返回，重试耗尽仍报错。

### Install / 安装

Install **[`dsh-review-format-guard`](https://www.npmjs.com/package/dsh-review-format-guard)** through DSH's plugin manager, or download **`dsh-review-format-guard-0.1.0.tgz`** below. Follow the [English guide](https://github.com/MintMilk777/dsh-review-format-guard/blob/main/INSTALL.en.md). The ZIP archives contain source code. Checksums are in `SHA256SUMS.txt`.

在 DSH 插件页面安装 npm 包 **[`dsh-review-format-guard`](https://www.npmjs.com/package/dsh-review-format-guard)**，或下载下方 **`dsh-review-format-guard-0.1.0.tgz`**。按[中文指南](https://github.com/MintMilk777/dsh-review-format-guard/blob/main/INSTALL.md)安装。ZIP 文件为源码，校验值见 `SHA256SUMS.txt`。

### Compatibility / 兼容性

**RC5 follow-up (2026-10-30):** All 7 isolated host integration checks passed with the installed Windows DSH **0.2.1-rc.5** components. Its complete auto-review source, and rc.4's, is identical to rc.3. Existing v0.1.0 works without code changes; live model tests were not repeated on rc.5.

**RC5 补充核验（2026-10-30）：** 使用本机 Windows DSH **0.2.1-rc.5** 的实际组件完成 7 项独立宿主接入检查，全部通过。rc.4、rc.5 的整个自动审查源码均与 rc.3 相同。现有 v0.1.0 无需改代码即可适用；未在 rc.5 上重跑真实模型测试。

Tested on Windows / DSH **0.2.1-rc.3**. Versions **0.2.1-alpha.2, alpha.3, alpha.4, alpha.5, rc.1, and rc.2** share the same auto-review source and may also work; they have not each been installation-tested. No DSH version-range installation block is imposed. Unrecognized review policies and request structures pass through unchanged.

实测环境为 Windows / DSH **0.2.1-rc.3**。**0.2.1-alpha.2、alpha.3、alpha.4、alpha.5、rc.1、rc.2** 的自动审查源码相同，理论上可能适用，尚未逐个安装验证。安装不按 DSH 版本号拦截；未知审查政策和请求结构原样转发。

Verification: **51 offline tests**, **7 isolated host checks**, and a recorded model test run of **67 fictional cases across 17 configured routes**. See the [test scope](https://github.com/MintMilk777/dsh-review-format-guard/blob/main/COMPATIBILITY.en.md) for conditions and limits.

验证包括 **51 项离线测试**、**7 项独立宿主检查**，以及 **17 个模型入口、67 个虚构样例**的模型测试记录。条件与限制见[兼容说明](https://github.com/MintMilk777/dsh-review-format-guard/blob/main/COMPATIBILITY.md)。

Valid JSON does not guarantee correct model judgment. Retries may add latency and API charges. Report reproducible problems in [Issues](https://github.com/MintMilk777/dsh-review-format-guard/issues), with private content removed.

格式正确不代表模型判断正确，重试可能增加耗时与费用。反馈请到 Issues，并去掉私人内容。

Initiated and maintained by MintMilk777, with development and testing assistance from OpenAI Codex.

由 MintMilk777 发起并维护，使用 OpenAI Codex 协助开发与测试。
