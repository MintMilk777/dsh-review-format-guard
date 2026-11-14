# Changelog / 更新记录

## 0.1.3 · 2026-11-14

- Clarify that the last tool-call record is the action awaiting review. Preserve the original policy, source roles, history, and pending arguments.
- Distinguish fixed stream failure categories without logging response text or tool arguments. Validation, denial handling, retry limits, and waiting defaults remain unchanged.
- Remove verified whitespace-only blocks around a verdict so the normalized response also satisfies DSH's native parser; preserve meaningful content and invalidate stale replay metadata.

明确最后一条工具调用记录就是当前待审查动作，减少模型误把它当成历史、继续等待下一条请求的情况。保留原规则、来源角色、历史和参数；细分流结构错误，便于定位断流、正文缺失和内容冲突，不记录原始回复或工具参数。确认仅含空白的内容块会整体移除，使结论能被原生解析器读取；有效内容保留，失效重放元数据清除。校验、合法拒绝、重试次数和等待默认值不变。

## 0.1.2

- Add per-attempt total / first-content / idle deadlines of 180 / 120 / 30 seconds, preserving explicit older settings.
- Merge adjacent plain fragments with separate retained-event, raw-event, content, replay, buffer, and conservative memory budgets.
- End definite failures promptly with safe classifications and attempt history; preserve valid denials and bounded retries, with no retry on user cancellation.
- Keep cancellation and unload responsive, clean up per-read listeners, and preserve primary failures when closing a stream fails.
- Preserve later-fragment metadata when removing JSON fences, clear stale signatures on changed text, and leave unchanged verdict fragments and signatures intact when only reasoning whitespace needs correction.
- Distinguish current verification from historical results, including live first-content timeouts. Final test totals and packaged checks are recorded separately in the compatibility guide.

每次尝试采用 180 秒总期限、120 秒首内容和 30 秒空闲期限，旧显式配置仍有效。相邻纯碎片合并，各项资源分别计量。明确错误及时结束并保留安全分类与尝试历史；合法拒绝保留，用户取消不重试，资源超限将总尝试上限收为两次，其他可重试错误最多三次（第三次才首次超限则直接结束）。改善取消、卸载与读取监听清理，关闭错误不覆盖主因。去除结论围栏时保留后续元数据、清除修改文字旧签名；仅修思考空白时保留无需修改的结论片段与签名。兼容说明区分当前与历史验证，如实记录首内容超时；最终通过 163 项离线测试、16 项宿主检查、112 次保存返回回放及打包后的隔离安装卸载检查。

## 0.1.1

- Support the ordered native auto-review protocol used by DSH 0.2.2-rc.1 while retaining legacy request support.
- Keep the pending call last and preserve all source-labelled history records during reinforcement.
- Verified with 76 offline tests, 8 isolated host checks, 49 live fictional review cases, and 15 injected-fault recovery cases.
- Update removal commands for the bundled pnpm version and verify installation/removal in an isolated DSH home.

适配 DSH 0.2.2-rc.1 的多消息审查协议，保留旧版支持。规则提醒放在首条环境消息中，历史记录及最后的待审查动作不变。76 项离线测试、8 项独立宿主检查、49 个真实模型虚构样例与 15 组故障注入恢复通过；同步修正并验证安装卸载指南。

## 0.1.0

- Validates complete native DSH auto-review responses and retries malformed results within a fixed limit.
- Preserves valid denials; handles limited JSON wrappers and reasoning-whitespace differences.
- Includes offline and isolated host tests, English and Chinese guides, and a bilingual issue form.

为 DSH 原生自动审查增加完整返回校验和有限重试，保留合法拒绝，兼容有限的 JSON 包装和思考过程空白差异。附离线测试、独立宿主测试、中英文指南与双语问题表单。
