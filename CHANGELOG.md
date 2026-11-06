# Changelog / 更新记录

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
