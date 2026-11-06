# Compatibility and tests

[中文](COMPATIBILITY.md) · [Home](README.md)

Plugin v0.1.1 was checked on 2026-11-06 with the installed Windows DSH 0.2.2-rc.1. It recognizes that host's ordered review protocol and retains the older four-section protocol. Unknown policies or request structures pass through unchanged. There is no DSH version-range installation block.

## Checks performed

- **76 offline tests**, including 882 verdict field/type combinations and 2,000 deterministic malformed inputs. Those combinations are included in the test total.
- **8 isolated host checks** using the installed request renderer, Cordis, BlockAssembler, and native decision parser.
- **49 fictional review cases across 11 configured routes**, sent through the installed LlmRuntime and PiAiAdapter with the installed plugin. All 49 returned valid results matching the preset expectations. There were 51 requests: one transport failure on each of the two third-party DeepSeek/GLM routes recovered after one retry.
- **15 fault-injection cases across three routes**: simulate non-JSON, duplicate members, conflicting conclusions, a missing finish, or a delta/snapshot disagreement on the first dispatch, then obtain a real model decision on retry. All 15 passed with 30 dispatches: 15 simulated responses and 15 real requests. This verifies the recovery chain, not the frequency of naturally occurring malformed responses.
- **Standard installation and removal** in an isolated DSH home, including bundle registration cleanup, preservation of user overrides, and checks that the real desktop profile did not change.

No tool executor was registered for review tests and no real conversation history was used. The DeepSeek official provider and disabled Gemini routes were excluded. Models were identified by their configured service names; their underlying identities were not independently verified.

| Configured model route | Passed / cases | Real requests |
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

The fault-injection routes were deepseek-v4.1-flash, glm-5.3-flash, and codex-auto-review. Tests covered read-only work, ordinary project writes, authorized and unauthorized deletion, revoked or mismatched authorization, production reads, and fictional sensitive-data exfiltration.

## Older hosts and limits

Earlier v0.1.0 checks used Windows DSH 0.2.1-rc.3 and rc.5. Their native auto-review source is identical to rc.4 and to 0.2.1-alpha.2 through alpha.5, rc.1, and rc.2. v0.1.1 retains this legacy protocol and tests it offline; it was not freshly installed on each older host.

Formatting checks do not guarantee correct authorization judgment. These examples do not establish compatibility with every model, gateway, host, or high-risk situation. Sustained outages and authentication failures can still stop a review.

Upstream source: [0.2.2-rc.1](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/experimental/auto-review/src/index.ts), [0.2.1-rc.3](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/experimental/auto-review/src/index.ts), and [0.2.1-rc.5](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/experimental/auto-review/src/index.ts).
