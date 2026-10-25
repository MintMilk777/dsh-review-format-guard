# Implementation notes

[中文](TECHNICAL.md) · [Home](../README.md) · [Test scope](../COMPATIBILITY.en.md)

The plugin registers a prepended `llm/stream` listener. It does not replace DSH's reviewer or tool gate. The listener returns an async iterable synchronously, as the host expects.

## Request recognition

`nativeReviewRequest` checks the SHA-256 of the native system policy, temperature zero, an absent or empty tools list, and one user text message containing ENVIRONMENT, PROJECT_INSTRUCTIONS, FILTERED_HISTORY, and PENDING_ACTION. The JSON sections must also have the expected basic shape. Ordinary chat, third-party review prompts, and unknown policy versions pass through untouched.

By default, provider/model names do not decide whether a request is handled. The optional `providerIds` list can narrow provider routes; an empty list leaves all recognized native-review routes eligible.

The original policy and data are retained. The plugin repeats that same policy after the data and asks for the single decision object. This may help gateways that ignore or replace system messages, but it still relies on model compliance. It is not a deterministic repair of meaning.

## Response handling

Each received chunk is copied before the next one can mutate it. The full attempt is buffered and checked for block order, finish status, content consistency, and the native risk/decision schema before anything is released to the caller.

Normalization is limited to a whole-response JSON code fence, outer whitespace, an initial byte-order mark, and a checked whitespace-only mismatch in reasoning snapshots. Verdict delta/snapshot conflicts, duplicate keys, multiple objects, prose, and tool-call markup remain errors. The plugin never extracts an allow from arbitrary text.

A valid denial is returned immediately. Invalid responses and selected temporary provider failures can be retried. Each attempt makes a fresh call through the normal LLM chain; an owned weak set prevents the listener from handling its own forwarded request recursively. Cancellation, authentication failures, and unload stop retries as applicable. Exhaustion yields an error finish, not a fabricated decision.

## Lifecycle and limits

The listener belongs to the plugin context. Disposal aborts its active attempts; once DSH unloads the plugin, later requests follow the original chain. The plugin itself does not edit the permission mode. Normal DSH package management still writes dependency, lock, and bundle records.

Defaults for the development API `apply(ctx, options)`:

```json
{"enabled":true,"providerIds":[],"retries":2,"timeoutMs":60000,"retryDelayMs":500,"maxBytes":262144,"maxChunks":8192}
```

These options are supplied through the code API; no settings panel is included. The runtime uses Node.js built-ins, has no third-party runtime dependencies, and reads neither configuration files nor app.asar. Logs contain request sequence, attempt counts, normalization status, and fixed error codes rather than raw requests or replies.

The package has no `engines.dsh` installation range. Runtime handling still requires a recognized policy fingerprint and request structure.

## Review the code

- [lib/index.js](../lib/index.js): listener, retries, cancellation, and disposal.
- [lib/protocol.js](../lib/protocol.js): policy fingerprint, request checks, and decision validation.
- [lib/stream.js](../lib/stream.js): copied chunks, stream validation, and normalization.

The offline suite uses a licensed policy/parser snapshot that is not shipped in the installable package. Optional host checks read app.asar in a separate test process. Neither test path is a tool executor. See [the contribution guide](../CONTRIBUTING.en.md) for commands.
