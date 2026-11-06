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

The plugin checks the whole response, removes a few clearly defined formatting wrappers, and retries invalid results. A valid denial is returned immediately. If all attempts fail, the review still fails; the plugin does not invent an approval.

## Install

Install **`dsh-review-format-guard`** from DSH's plugin page. For a regular `dsh web` setup:

```sh
dsh plugin --profile web add dsh-review-format-guard --ignore-scripts
```

For Desktop's bundled command, local archives, and uninstall steps, see the [installation guide](INSTALL.en.md). A prebuilt `.tgz` is also available in [Releases](https://github.com/MintMilk777/dsh-review-format-guard/releases/tag/v0.1.1).

Restart DSH if prompted, check that the plugin is enabled, and keep the conversation in **Auto review** mode. Try a simple read-only request, such as “Show the current working directory without changing any files.”

## What it changes

- Handles requests that match the known native review policy and message structure, without a provider or model-name allowlist by default.
- Keeps the native policy and pending-action data. For ordered reviews, repeats the policy in the first environment message while leaving all history records and the final pending call unchanged. Older four-section requests retain their original handling.
- Buffers the response before returning it to DSH. It accepts only a complete decision that follows the native field rules.
- Can remove a JSON code fence, surrounding whitespace, or a leading byte-order mark. It also handles a checked whitespace-only difference in reasoning snapshots. It never searches prose, reasoning, or tool-call markup for an approval to extract.
- Makes at most three attempts by default, including retries for some temporary service errors. Each attempt has a default 60-second limit; some failures stop sooner.

It uses DSH's plugin interface without replacing the built-in reviewer or changing provider URLs and permissions.

## Compatibility

**v0.1.1:** Tested on Windows with DSH `0.2.2-rc.1`: 76 offline tests, 8 isolated host checks, and 49 fictional review cases across 11 configured model routes passed. Another 15 fault-injection cases confirmed that malformed first responses are rejected before a retry obtains a real model decision.

The older four-section review protocol is still supported. Earlier v0.1.0 checks used DSH `0.2.1-rc.3` and `rc.5`; these installations were not repeated for v0.1.1.

There is no DSH version-range installation block. Unrecognized review policies and request structures pass through unchanged, so the plugin has no effect on them.

See [compatibility and test results](COMPATIBILITY.en.md) for the tested scope and upstream source references.

## Limits and feedback

Valid JSON does not guarantee a correct authorization decision. Retries may add latency and API charges, and cannot restore an unavailable service. Authentication failures, valid denials, and errors after tool execution need to be investigated separately.

This plugin's logs contain diagnostic codes and counts rather than raw conversations, credentials, or model replies. DSH and your provider control their own logs.

To stop using it, disable it in DSH or follow the [uninstall instructions](INSTALL.en.md#uninstall). Report reproducible problems in [Issues](https://github.com/MintMilk777/dsh-review-format-guard/issues), with secrets and private content removed.

## Development

Run `npm test` from the source checkout with a supported Node.js version. The 76 offline tests use only Node.js built-ins and need no API key, DSH installation, or model requests. Optional host integration checks are described in [CONTRIBUTING.en.md](CONTRIBUTING.en.md). See [the implementation notes](docs/TECHNICAL.en.md) for the request and stream handling.

Initiated and maintained by MintMilk777, with development and testing assistance from OpenAI Codex.

[MIT](LICENSE). The test snapshot retains [DeepSeek's MIT notice](fixtures/LICENSE.deepseek).
