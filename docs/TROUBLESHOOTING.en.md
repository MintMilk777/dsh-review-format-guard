# Troubleshooting

[中文](TROUBLESHOOTING.md) · [Install](../INSTALL.en.md) · [Home](../README.md)

Start with the DSH version, plugin version, and the conversation's permission mode. A successful tool call in Full access mode does not test auto-review.

| Symptom | What to check |
|---|---|
| `dsh` command not found | Use the desktop app's bundled command as described in the [installation guide](../INSTALL.en.md). |
| Package or release cannot be found | Check the package name, registry, and download URL. The attached `.tgz` is an alternative installation source. |
| New npm release is held back | Package managers can delay newly published versions. Follow the reported release-age policy; do not disable global protections to fix an unrelated error. |
| Original JSON error, with no plugin prefix | Check enablement, profile, restart requirements, and policy compatibility. The missing prefix alone does not prove that installation failed. |
| `Review format guard: after 3 attempt(s)` | The plugin handled and retried the request, but no acceptable response arrived. Report a redacted error and minimal reproduction. |
| `REVIEW_JSON_INVALID` or `REVIEW_SCHEMA_INVALID` | The response is incomplete or has invalid fields. Do not manually cut an approval out of the surrounding text. |
| `REVIEW_STREAM_INVALID` | Stream blocks or observed snapshots disagree. Include the API type and a small fictional example. |
| Long wait or timeout | Defaults per attempt are 180 seconds total, 120 seconds for first content, and 30 seconds without new meaningful content once started. Three attempts can take about nine minutes plus retry delays; see [waiting and retries](TECHNICAL.en.md#waiting-and-retries). |
| A valid denial | DSH handles it through its usual review/approval flow. The plugin does not retry just to obtain an allow. |
| The tool ran, then failed | Investigate the tool, path, and environment. That is a different stage from review response parsing. |

The package has no hard DSH version-range check, but unfamiliar policies are passed through unchanged. See [Compatibility](../COMPATIBILITY.en.md) if a different host version installs successfully but the plugin has no effect.

## Failure classifications

All bounded retries below respect `retries`: the default is two retries, or three attempts including the first. Valid denials complete after one fully validated attempt and are not retried. Resource-limit failures have the tighter ceiling described below. Cancellation or plugin unload stops active waits and further retries.

| Code | Retry behavior and next step |
|---|---|
| `REVIEW_TIMEOUT` | Bounded retry. The total, first-content, or idle deadline expired; the safe error description identifies the stage. Check for an explicitly configured shorter `timeoutMs`. |
| `REVIEW_CANCELLED` | No retry. The request was cancelled or the plugin unloaded. |
| `REVIEW_JSON_INVALID`, `REVIEW_SCHEMA_INVALID`, `REVIEW_DUPLICATE_KEYS`, `REVIEW_TEXT_MISSING` | Bounded retry. Missing text, incomplete JSON, invalid fields, or duplicate keys. Do not manually assemble an approval. |
| `REVIEW_STREAM_INVALID` | Up to three attempts within `retries`. Fixed categories distinguish action blocks (`action-block`), conflicting snapshots (`snapshot-conflict`), no final text (`missing-conclusion`), multiple text blocks (`block-order`), truncated output (`output-limit`), and no terminal event (`missing-finish`), among other structural failures. Unknown reasons stay generic. Full validation remains required; reasoning or tool calls are never mined for an approval. |
| `REVIEW_SIZE_LIMIT` | At most two total attempts once a resource limit is hit, subject to `retries` (0 means one attempt; 1 means at most two). If first hit on attempt three after other failures, it ends there. The safe description identifies the exceeded budget; see [stream budgets](TECHNICAL.en.md#stream-budgets). |
| `REVIEW_UPSTREAM_UNSUPPORTED_REASONING_EFFORT` | No retry. The current channel does not support the requested reasoning effort. DSH can reject an unsupported `reasoningEffort=max` locally with `UNSUPPORTED_REASONING_EFFORT`, before any network request. Check the channel capability and call settings. The plugin does not silently lower the effort setting, switch models, or alter the model's review decision. |
| `REVIEW_UPSTREAM_AUTH` | No retry. Authentication failed or credentials are invalid or missing. Check service configuration without sharing credentials. |
| `REVIEW_UPSTREAM_QUOTA`, `REVIEW_UPSTREAM_ACCOUNT_QUOTA` | No retry. Provider or account quota is exhausted; check available quota. |
| `REVIEW_UPSTREAM_CONTEXT_WINDOW_EXCEEDED`, `REVIEW_UPSTREAM_INVALID_REQUEST` | No retry. Input exceeds the provider's context window, or the request is invalid. Reduce the input or correct the request before trying again. |
| `REVIEW_UPSTREAM_RATE_LIMIT`, `REVIEW_UPSTREAM_TIMEOUT`, `REVIEW_UPSTREAM_SERVER` | Bounded retry. The provider explicitly reported temporary rate limiting, a timeout, or a server failure. Check service status if it persists. |
| `REVIEW_UPSTREAM_TRANSPORT`, `REVIEW_CONNECTION_FAILURE` | Bounded retry. The former is a provider-reported network or transport failure; the latter is an exception with a recognized connection error code. |
| `REVIEW_UPSTREAM_EMPTY_RESPONSE` | Bounded retry. The provider explicitly reported an empty response. |
| `REVIEW_UPSTREAM_FAILURE`, `REVIEW_STREAM_FAILURE` | No retry. An unclassified provider failure or stream exception needs investigation; error wording alone does not establish a temporary network problem. |

Usage reports, whitespace, and repeated snapshots do not extend the wait. Meaningful text or reasoning resets only the idle deadline, never the total deadline. Explicit older `timeoutMs` values still apply. See [implementation notes](TECHNICAL.en.md#waiting-and-retries) for the full rules.

Plugin logs contain request sequence, attempt counts, normalization status, safe error codes, and elapsed milliseconds, not conversations, model replies, or raw upstream errors. A short failed-attempt history is included in later success logs and final failure descriptions. JSON parsing errors may also include a fixed response-shape classification. These details help narrow a problem; they do not prove what a gateway does internally.

Use [Issues](https://github.com/MintMilk777/dsh-review-format-guard/issues) and include versions, OS, API type, steps, and redacted errors. Replace private provider names with labels such as `provider-a`. Do not post keys, authorization headers, cookies, full conversations, or real pending-action parameters. Keep high-risk examples fictional and isolated from tool execution.

Some tested DSH behavior changes the conversation's permission mode after restart. Check it in the UI; this plugin does not change that mode.
