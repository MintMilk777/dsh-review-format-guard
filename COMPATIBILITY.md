# 兼容性与验证范围

[English](COMPATIBILITY.en.md) · [首页](README-zh-CN.md)

插件 v0.1.0 的实测环境为 Windows / DSH 0.2.1-rc.3。模型测试记录于 2026-10-25，官方源码核对于 2026-10-26。

已在标准插件安装及重启之后，通过独立进程载入实际安装版本，使用 DSH 自带的 LlmRuntime、PiAiAdapter、Cordis、BlockAssembler 和原生 readDecision 完成测试，实际请求已配置服务取得模型返回。所有动作仅为虚构审查描述，没有注册工具执行器，也没有提交到真实对话。

模型名称来自本机服务声明，未验证服务背后真实模型身份。覆盖 OpenAI Completions 与 Responses 两类已配置接口；没有测试所有第三方服务或 HTTP 协议。排除了 6 个生图入口。

| 模型入口名称 | 通过 / 样例数 | 模型请求次数 |
|---|---:|---:|
| gemini-3.8-flash-high | 3 / 3 | 3 |
| gemini-3-flash | 3 / 3 | 3 |
| gemini-3.5-flash-lite | 3 / 3 | 3 |
| gemini-3.1-flash-lite | 3 / 3 | 3 |
| claude-opus-4-6-thinking | 3 / 3 | 3 |
| claude-sonnet-4-6 | 3 / 3 | 3 |
| gpt-oss-120b-medium | 3 / 3 | 3 |
| codex-auto-review | 3 / 3 | 3 |
| gpt-6.1-sol | 3 / 3 | 3 |
| gpt-6-astra | 3 / 3 | 3 |
| gpt-6-sol | 3 / 3 | 3 |
| gpt-6-luna | 3 / 3 | 3 |
| gpt-5.6-sol | 3 / 3 | 3 |
| gpt-5.6-terra | 3 / 3 | 3 |
| gpt-5.6-luna | 3 / 3 | 3 |
| deepseek-v4.1-flash | 11 / 11 | 11 |
| glm-5.3-flash | 11 / 11 | 11 |

67 个样例全部通过，每个样例请求一次，没有触发重试。重试行为另用模拟故障验证；这轮模型测试不能证明真实服务故障后的恢复能力。

离线验证：51 项全部通过，其中包含 882 组字段/类型组合与 2000 组确定性的畸形输入。并发、取消、卸载、重新启用、明确拒绝不重试、认证失败不重试、结论冲突、重复字段及大小/时间上限均覆盖。另有 7 组真实宿主接入测试全部通过，使用了本机实际的审查解析器，并比较了原生政策与受支持快照。

## 这些结果不能说明什么

这些结果不保证所有模型、中转服务或高风险场景都能正常工作，也不能证明模型的授权判断正确。

## 源码对比支持的候选版本

0.2.1-alpha.2、alpha.3、alpha.4、alpha.5、rc.1、rc.2 的自动审查源文件与实测 rc.3 完全相同，因此列为理论上可能适用的版本，不算新增安装实测。更早版本虽保留部分相同协议，宿主接入已有差异，暂不承诺可用。

安装包不限制 DSH 版本范围，但这不等于所有宿主都兼容。运行时仍要匹配政策指纹和请求结构；当时的官方开发分支已改变这两项，v0.1.0 会原样转发其审查请求，也就不会修复那类格式问题。

官方源码：[alpha.2](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/experimental/auto-review/src/index.ts)、[rc.3](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/experimental/auto-review/src/index.ts) 与[已检查的开发提交](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/experimental/auto-review/src/index.ts)。文件对比时统一了 CRLF / LF 换行。
