# Compatibility and test results

[中文](COMPATIBILITY.md) · [Home](README.md)

Plugin v0.1.0 was tested with DSH 0.2.1-rc.3 on Windows. Model tests were recorded on 2026-10-25; upstream source was compared on 2026-10-26.

## What was tested

- **51 offline tests**, including 882 field/type combinations and 2,000 deterministic malformed inputs. Those combinations are already included in the 51 tests, not extra test totals.
- **7 isolated host integration checks**, using the installed Cordis, BlockAssembler, and native review parser. They cover retries, denials, conflicting responses, reused stream objects, unloading, and re-enabling.
- **67 fictional review cases across 17 configured model routes**, using the installed LlmRuntime, PiAiAdapter, and native parser after standard plugin installation and restart. No tool executor was registered and no test was sent to a live conversation.

Model route names were reported by the configured services; their underlying model identities were not independently verified. The test covered the configured OpenAI Completions and Responses interfaces, not every provider or wire protocol. Six image-generation routes were excluded.

| Configured model route | Passed / cases | Model requests |
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

All 67 cases passed in that run, with one model request per case and no retries. Retry behavior was covered separately with injected failures; this run does not show recovery from a real transient outage.

## What these results do not show

Formatting checks do not establish that the model made the right authorization decision. Passing these examples does not guarantee every model, gateway, host version, or high-risk scenario.

## Source-based version candidates

The complete auto-review source file is identical across DSH 0.2.1-alpha.2, alpha.3, alpha.4, alpha.5, rc.1, rc.2, and rc.3. The first six are reasonable candidates for trying this plugin, but only rc.3 was installation-tested. Earlier releases retain parts of the same protocol but differ in host integration; they have not been validated.

The package has no DSH version-range installation block. That does not establish compatibility with every host. The plugin still requires a matching policy fingerprint and request structure before it handles a request. In the upstream development commit checked on 2026-10-26, both have changed, so v0.1.0 passes those requests through unchanged rather than repairing them.

Upstream source: [alpha.2](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/experimental/auto-review/src/index.ts), [rc.3](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/experimental/auto-review/src/index.ts), and the [checked development commit](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/experimental/auto-review/src/index.ts). Source equality was checked after normalizing CRLF line endings to LF.
