# 兼容性与测试

[English](COMPATIBILITY.en.md) · [首页](README-zh-CN.md)

插件 v0.1.1 于 2026-11-06 使用本机 Windows / DSH 0.2.2-rc.1 核验，支持该版本的多消息审查协议，同时保留旧版四栏目协议。未知政策或请求结构仍原样转发。安装包不按 DSH 版本范围拦截。

## 已完成的检查

- **76 项离线测试**，含 882 组结论字段/类型组合及 2000 组确定性的畸形输入；这些组合包含在测试总数内。
- **8 项独立宿主检查**，使用实际安装的请求生成函数、Cordis、BlockAssembler 和原生结论解析器。
- **11 个模型入口、49 个虚构审查样例**，通过本机 LlmRuntime、PiAiAdapter 和已安装插件请求真实服务。49 个结果均格式合格且符合样例预设判断，共 51 次请求：第三方 DeepSeek 和 GLM 各有一次连接故障，均重试一次后恢复。
- **3 个入口、15 组故障注入测试**：首轮分别模拟非 JSON、重复字段、结论冲突、缺少结束标记或增量与最终文本不一致，再由插件重试请求真实模型。15 组全部通过，共 30 次调用，其中 15 次为模拟返回、15 次为真实请求。这验证恢复链路，不代表真实上游畸形返回的发生频率。
- **标准安装与卸载**：在独立 DSH 目录中验证挂载记录清理、用户覆盖配置保留，并确认真实桌面配置未变。

审查测试未注册工具执行器，没有使用真实会话历史。排除了 DeepSeek 官方服务和已关闭的 Gemini。模型名称取自配置中的服务入口，未独立确认背后真实模型身份。

| 模型入口 | 通过 / 样例数 | 真实请求次数 |
|---|---:|---:|
| gpt-6.1-sol | 3 / 3 | 3 |
| gpt-6-astra | 3 / 3 | 3 |
| gpt-6.1-terra | 3 / 3 | 3 |
| gpt-6-sol | 3 / 3 | 3 |
| gpt-6-luna | 3 / 3 | 3 |
| gpt-5.6-sol | 3 / 3 | 3 |
| gpt-5.6-terra | 3 / 3 | 3 |
| gpt-5.6-luna | 3 / 3 | 3 |
| codex-auto-review | 3 / 3 | 3 |
| deepseek-v4.1-flash | 11 / 11 | 12 |
| glm-5.3-flash | 11 / 11 | 12 |

故障注入使用 deepseek-v4.1-flash、glm-5.3-flash 和 codex-auto-review。样例覆盖普通读取、项目内写入、已授权及未授权删除、撤回或目标不符的授权、生产读取，以及虚构的敏感信息外发。

## 旧宿主与限制

早期 v0.1.0 曾在 Windows / DSH 0.2.1-rc.3 和 rc.5 上核验。两者的原生自动审查源码与 rc.4，以及 0.2.1-alpha.2 至 alpha.5、rc.1、rc.2 相同。v0.1.1 保留旧协议并有离线回归测试，本轮未在这些旧宿主上逐个重新安装。

格式正确不保证模型判断正确；通过这些样例不能证明所有模型、中转、宿主或高风险情形都适用。持续不可用的服务和认证失败仍可能导致审查报错。

官方源码：[0.2.2-rc.1](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/experimental/auto-review/src/index.ts)、[0.2.1-rc.3](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/experimental/auto-review/src/index.ts)、[0.2.1-rc.5](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/experimental/auto-review/src/index.ts)。
