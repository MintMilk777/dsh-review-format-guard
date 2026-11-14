# Compatibility and tests

[中文](COMPATIBILITY.md) · [Home](README.md)

Version 0.1.3 was checked on Windows with DSH 0.2.2-rc.3. It recognizes the ordered review protocol used by 0.2.2-rc.1 through rc.3 and retains the older four-section protocol.

There is no DSH version-range installation block. At runtime, unknown policies or request structures pass through unchanged.

## Release checks

| Check | Scope |
|---|---|
| 185 offline tests | Request boundaries, strict JSON fields, stream consistency, blank-block cleanup, refusal preservation, retries, deadlines, cancellation, and budgets |
| 18 host checks | Installed RC3 request renderer, Cordis, BlockAssembler, and native decision parser, including blank blocks around valid denials |
| 308 saved-response replays | 77 complete valid responses replayed in four fragment layouts; these are not 308 independent model requests |
| Isolated installation and removal | Package files, bundle registration, user overrides, and unchanged desktop configuration |

The previous local trial used the same boundary and diagnostic changes. Source review before release found one additional compatibility gap: the plugin could accept a verdict surrounded by blank blocks that the native parser rejected. Version 0.1.3 removes those verified blank blocks as a whole, preserves the verdict and meaningful reasoning, and invalidates stale replay metadata.

## Live checks

After the blank-block fix, four additional checks with the final 0.1.3 source passed through configured Claude, third-party DeepSeek, GLM, and GPT routes. These checks are separate from the trial totals below.

Before that final blank-block fix, the trial completed 62 real API requests across 48 cases on configured GPT, Claude, third-party DeepSeek, GLM, Kimi, and Gemini routes. Forty-seven cases passed; one failed because the upstream group did not provide the requested Gemini model. Three failed attempts were injected locally to check recovery and are excluded from the network-request count.

Two cases also ran actual file writes and reads inside a dedicated test directory, then verified the model's continued answer. Other tool bodies were stubs. Earlier diagnostic probes separately observed a prose response and a test-imposed 45-second cancellation; neither is counted as a success.

The main matrix used a test-only 4096-token review output ceiling. Supplementary and installed-module checks retained the host/provider defaults. Tests had a 180-second parent deadline per case. Model names refer to configured labels, not independently verified underlying identities. DeepSeek official was excluded, and no real conversation history was sent.

## Limits

The isolated checks use DSH's real review gate, renderer, adapter, assembler, and parser, with test session and execution services. They do not exercise the full OPS/PTC execution environment. Desktop installation and component startup were also checked during local trial.

These results describe the tested cases, not an overall failure rate. Some production stream failures still lack a confirmed cause. Formatting checks do not guarantee correct authorization judgments, sustained upstream availability, or compatibility with every tool and plugin combination.

Earlier installations covered the legacy protocol on Windows DSH 0.2.1-rc.3 and rc.5; they were not repeated on every older host for this release. The legacy protocol remains covered by the offline suite.

Upstream source: [0.2.2-rc.3](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/experimental/auto-review/src/index.ts), [0.2.2-rc.1](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/experimental/auto-review/src/index.ts), and [0.2.1-rc.3](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/experimental/auto-review/src/index.ts).
