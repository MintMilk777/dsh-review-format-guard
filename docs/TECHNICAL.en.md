# Implementation notes

[中文](TECHNICAL.md) · [Home](../README.md) · [Test scope](../COMPATIBILITY.en.md)

The plugin registers a prepended `llm/stream` listener. It does not replace DSH's reviewer or tool gate. The listener returns an async iterable synchronously, as the host expects.

## Request recognition

`nativeReviewRequest` checks a known SHA-256 policy fingerprint, temperature zero, an absent or empty tools list, and the matching request structure. The legacy protocol uses one four-section user message. The ordered protocol uses an environment message followed by JSON records, ending in a tool call with a preceding matching schema. If a purpose marker exists, it must be `auto-review`. Ordinary chat, third-party review prompts, and unknown policy versions pass through untouched.

By default, provider/model names do not decide whether a request is handled. The optional `providerIds` list can narrow provider routes; an empty list leaves all recognized native-review routes eligible.

The original policy and data are retained. For legacy requests the policy is repeated after the four sections. For ordered requests the first environment message clarifies record boundaries and repeats the policy: the final tool-call record is already pending review, even when a transport combines adjacent user messages. Later JSON records, source roles, session identity and purpose remain unchanged, with the pending call still last. This may reduce cases where a reviewer mistakes the action for history or continues the conversation, but it still relies on model compliance. It is not a deterministic repair of meaning.

## Response handling

Each received chunk is copied before the next one can mutate it. Block structure and consistency are checked as events arrive, so definite failures end the attempt promptly with a safe reason. Successful output remains buffered until the whole stream, finish status, content consistency, and native risk/decision schema pass validation.

After full validation, blocks confirmed to contain only whitespace are removed as complete blocks, including their start, delta, and end events. This aligns the output with the native parser, which otherwise counts blank blocks as extra content. Meaningful text, reasoning, metadata on retained blocks, and usage events remain intact. Any changed response drops stale finish replay metadata. All received events still count toward collection budgets before normalization.

Normalization is limited to a whole-response JSON code fence, outer whitespace, an initial byte-order mark, and a checked whitespace-only mismatch in reasoning snapshots. Verdict delta/snapshot conflicts, duplicate keys, multiple objects, prose, and tool-call markup remain errors. The plugin never extracts an allow from arbitrary text.

A valid denial is returned after full stream validation, without retrying for an allow. Invalid responses and selected temporary provider failures can be retried. Each attempt makes a fresh call through the normal LLM chain; an owned weak set prevents the listener from handling its own forwarded request recursively. Cancellation, unload, authentication or quota failures, oversized or invalid input, and unclassified failures stop retries. Exhaustion yields an error finish, not a fabricated decision.

Fast streams periodically yield so cancellation, unload, and deadline callbacks can run. Each read removes its abort listener when finished, avoiding accumulated waiting callbacks. Cancellation does not wait for a stuck read or close operation; close access, invocation, or asynchronous failures do not replace the primary failure. This cannot interrupt provider code that blocks synchronously.

JSON-fence normalization preserves extra metadata on later fragments and clears stale signatures on modified text. When only reasoning whitespace needs normalization, unchanged verdict fragments are neither merged nor stripped of signatures.

## Lifecycle and limits

The listener belongs to the plugin context. Disposal aborts its active attempts; once DSH unloads the plugin, later requests follow the original chain. The plugin itself does not edit the permission mode. Normal DSH package management still writes dependency, lock, and bundle records.

Defaults for the development API `apply(ctx, options)`:

```json
{
  "enabled": true,
  "providerIds": [],
  "retries": 2,
  "timeoutMs": 180000,
  "firstContentTimeoutMs": 120000,
  "idleTimeoutMs": 30000,
  "retryDelayMs": 500,
  "maxBytes": 262144,
  "maxChunks": 65536,
  "maxContentBytes": 262144,
  "maxReplayBytes": 262144,
  "maxBufferedChunks": 8192,
  "maxMemoryBytes": 4194304
}
```

These options are supplied through the code API; no settings panel is included. The runtime uses Node.js built-ins, has no third-party runtime dependencies, and reads neither configuration files nor app.asar. Logs contain request sequence, attempt counts, normalization status, safe error codes, and elapsed milliseconds. A short failed-attempt history is retained in success logs and final failures. Stream errors can identify fixed categories such as a missing conclusion, an action block, a snapshot conflict, or truncated output; raw requests, replies, and upstream error text are excluded.

The package has no `engines.dsh` installation range. Runtime handling still requires a recognized policy fingerprint and request structure.

## Waiting and retries

All three deadlines apply to one attempt; whichever expires first ends it:

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `180000` (180 seconds) | Fixed total deadline from attempt start through complete validation; never extended by content |
| `firstContentTimeoutMs` | `120000` (120 seconds) | Wait for the first non-whitespace text or reasoning content |
| `idleTimeoutMs` | `30000` (30 seconds) | After content starts, wait for more meaningful content; reset on each meaningful advance |

Progress means a non-whitespace text or reasoning delta, or the first non-whitespace closing snapshot for a block with no preceding deltas. Usage reports, whitespace-only content, closing snapshots after deltas, and repeated snapshots do not extend the wait. Reasoning counts as progress but cannot replace the final review decision. Replaying the validated buffer is not provider idle time.

Defaults apply only to omitted options. Explicit older `timeoutMs` values still apply: `60000` limits an attempt to 60 seconds even with a 120-second first-content deadline. The total deadline never resets.

`retries` defaults to 2 and cannot exceed 2, giving at most three attempts including the first. Each attempt starts fresh deadlines. With defaults, the worst case is about nine minutes plus retry delays of 500 and 1000 milliseconds, not 180 seconds for the whole request. First-content or idle timeouts and non-retryable errors can end it sooner. Missing or conflicting results retain this three-attempt ceiling. Once a resource limit is hit, the total attempt ceiling becomes two; if it first occurs on the third attempt, no further attempt follows. `retries: 0` still allows only one attempt, and `retries: 1` at most two. A valid denial needs only one fully validated attempt. There is no new shared deadline across retries.

See [failure classifications](TROUBLESHOOTING.en.md#failure-classifications) for retry behavior. Connection exceptions are recognized only by the connection codes listed in the source, including inspected causes; recognized cancellation takes precedence. A `fetch failed` message or the word “network” alone is not enough. Unknown exceptions are not retried blindly. Logs use safe classifications without upstream error messages, URLs, or raw cause chains.

## Stream budgets

Unlike the previous waiting-only approach, definite stream failures end the attempt as soon as they are detected, retaining a safe reason instead of waiting for the stream to close or time out. A successful result still waits for the entire stream and full validation; a plausible decision or a normal stop alone is not enough.

Only adjacent plain text or reasoning deltas with the same type and block index are merged. Plain means only `type`, `index`, and `text`; a merged run is limited to 4096 UTF-16 code units. This preserves reasoning text and does not discard extra metadata to make chunks merge. Events with extra fields remain separate.

All budgets apply independently per attempt; the first exceeded budget ends that attempt:

| Option | Default | What it counts |
|---|---|---|
| `maxBytes` | `262144` (256 KiB) | Serialized retained events after merging, still including full closing snapshots; also caps each incoming serialized event |
| `maxChunks` | `65536` | All original received events before merging, including reasoning and usage |
| `maxContentBytes` | `262144` (256 KiB) | Logical text and reasoning bytes; a closing snapshot does not count the same delta content twice |
| `maxReplayBytes` | `262144` (256 KiB) | Cumulative serialized `replayState` bytes |
| `maxBufferedChunks` | `8192` | Actual retained event count after merging |
| `maxMemoryBytes` | `4194304` (4 MiB) | Conservative accounting for retained representation, content copies, and object slots; not a measurement or ceiling of actual JavaScript heap memory |

The raw-event default increased from 8192 to 65536; the retained-event limit stays at 8192. An explicitly configured older `maxChunks: 8192` still applies. The numeric `maxBytes` default stays at 256 KiB, but its cumulative accounting now uses the merged representation. These are not unchanged size limits. Merging reduces some fragmentation overhead, not all differences between stream layouts: crossing the raw-event limit still fails even if the final text is small. Full snapshots and extra metadata can still reach other budgets.

## Review the code

- [lib/index.js](../lib/index.js): listener, retries, cancellation, and disposal.
- [lib/wait.js](../lib/wait.js): total, first-content, and idle deadlines per attempt.
- [lib/failures.js](../lib/failures.js): safe failure classification and retry decisions.
- [lib/protocol.js](../lib/protocol.js): policy fingerprint, request checks, and decision validation.
- [lib/stream.js](../lib/stream.js): copied chunks, incremental failure detection, complete validation, and normalization.
- [lib/budget.js](../lib/budget.js): adjacent delta merging and per-attempt resource accounting.

The offline suite uses a licensed policy/parser snapshot that is not shipped in the installable package. Optional host checks read app.asar in a separate test process. Neither test path is a tool executor. See [the contribution guide](../CONTRIBUTING.en.md) for commands.
