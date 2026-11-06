# DSH Review Format Guard

[中文](README-zh-CN.md) · [Install and uninstall](INSTALL.en.md) · [Troubleshooting](docs/TROUBLESHOOTING.en.md) · [Compatibility and tests](COMPATIBILITY.en.md)

A small plugin for DeepSeek Harness (DSH) that checks auto-review responses and retries malformed results.

Some third-party API gateways return prose, Markdown, tool-call markup, or incomplete JSON when DSH expects a review decision. This can make auto-review fail before a tool runs. This plugin is designed for that failure.

## When to use it

Consider it if a tool has not run and DSH reports errors such as:

```text
Auto review of tool "working_directory" failed; its body was not executed
Unexpected token ... is not valid JSON
REVIEW_JSON_INVALID
Review response is not one complete JSON object
```

The plugin checks the whole response, removes a few clearly defined formatting wrappers, and retries invalid results. A valid denial is returned after full stream validation, without retrying for an allow. If all attempts fail, the review still fails; the plugin does not invent an approval.

## Install

Install **`dsh-review-format-guard@0.1.2`** from DSH's plugin page. For a regular `dsh web` setup:

```sh
dsh plugin --profile web add dsh-review-format-guard@0.1.2 --ignore-scripts
```

For Desktop's bundled command, local archives, and uninstall steps, see the [installation guide](INSTALL.en.md). A prebuilt `.tgz` is also available in [Releases](https://github.com/MintMilk777/dsh-review-format-guard/releases/tag/v0.1.2).

Restart DSH if prompted, check that the plugin is enabled, and keep the conversation in **Auto review** mode. Try a simple read-only request, such as “Show the current working directory without changing any files.”

## What it changes

- Handles requests that match the known native review policy and message structure, without a provider or model-name allowlist by default.
- Keeps the native policy and pending-action data. For ordered reviews, repeats the policy in the first environment message while leaving all history records and the final pending call unchanged. Older four-section requests retain their original handling.
- Ends definite stream failures promptly and keeps a safe failure reason. Successful responses remain buffered until the whole stream and native decision fields pass validation.
- Can remove a JSON code fence, surrounding whitespace, or a leading byte-order mark. It also handles a checked whitespace-only difference in reasoning snapshots. It never searches prose, reasoning, or tool-call markup for an approval to extract.
- Makes at most three attempts by default. Each attempt has a fixed total deadline of 180 seconds (`timeoutMs: 180000`), a 120-second wait for first meaningful text or reasoning (`firstContentTimeoutMs: 120000`), and a 30-second idle limit after content starts (`idleTimeoutMs: 30000`).
- Usage reports, whitespace, and repeated snapshots do not extend the wait. Meaningful content resets only the idle deadline, never the total deadline. Explicit `timeoutMs` settings, including older values, still apply.
- Fast streams periodically yield to the event loop so cancellation, unload, and deadline callbacks can run. Each pending read owns a removable abort listener; completed reads do not accumulate callbacks on a shared pending promise. Cancellation does not wait for a stuck provider read or close operation. Close errors do not replace the primary failure.
- Three attempts can take about nine minutes plus retry delays, not 180 seconds for the whole request. Cancellation, authentication or quota failures, and oversized or invalid input are not retried. Known connection failures and selected temporary service errors get bounded retries; unknown exceptions do not. Resource-limit failures allow at most two total attempts, subject to `retries`; missing or conflicting results allow up to three, and a valid denial ends after one.
- Adjacent plain deltas of the same type and block index can merge without dropping reasoning or extra metadata. The raw-event limit rises from 8192 to 65536; actual buffered events remain capped at 8192. Retained serialized events (including snapshots), logical content, and replay state each have a 256 KiB limit, with a separate 4 MiB conservative memory budget, not an actual JavaScript heap ceiling. Explicit older limits still apply, and excessive raw events still fail. See [stream budgets](docs/TECHNICAL.en.md#stream-budgets).

It uses DSH's plugin interface without replacing the built-in reviewer or changing provider URLs and permissions.

## Compatibility

**v0.1.2:** Supports the recognized native review protocols, including the ordered-message protocol in DSH `0.2.2-rc.1`. Current and historical checks are distinguished in [Compatibility](COMPATIBILITY.en.md), including the latest first-content timeouts.

The older four-section review protocol is still supported. Earlier v0.1.0 checks used DSH `0.2.1-rc.3` and `rc.5`; these older-host installations have not been repeated for v0.1.2.

There is no DSH version-range installation block. Unrecognized review policies and request structures pass through unchanged, so the plugin has no effect on them.

See [compatibility and test results](COMPATIBILITY.en.md) for the tested scope and upstream source references.

## Limits and feedback

Valid JSON does not guarantee a correct authorization decision. Retries may add latency and API charges, and cannot restore an unavailable service. Authentication failures, valid denials, and errors after tool execution need to be investigated separately.

This plugin keeps a short history of safe error codes and elapsed time for failed attempts, including when a later attempt succeeds. Final failures include that history. Logs do not include raw conversations, credentials, model replies, or upstream error text. DSH and your provider control their own logs.

To stop using it, disable it in DSH or follow the [uninstall instructions](INSTALL.en.md#uninstall). Report reproducible problems in [Issues](https://github.com/MintMilk777/dsh-review-format-guard/issues), with secrets and private content removed.

## Development

Run `npm test` from the source checkout with a supported Node.js version. The offline tests use only Node.js built-ins and need no API key, DSH installation, or model requests. Optional host integration checks are described in [CONTRIBUTING.en.md](CONTRIBUTING.en.md). See [the implementation notes](docs/TECHNICAL.en.md) for the request and stream handling.

Initiated and maintained by MintMilk777, with development and testing assistance from OpenAI Codex.

[MIT](LICENSE). The test snapshot retains [DeepSeek's MIT notice](fixtures/LICENSE.deepseek).
