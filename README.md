# DSH Review Format Guard

[中文](README-zh-CN.md) · [Install and uninstall](INSTALL.en.md) · [Troubleshooting](docs/TROUBLESHOOTING.en.md) · [Compatibility and tests](COMPATIBILITY.en.md)

A small plugin for DeepSeek Harness (DSH) that checks auto-review responses and retries malformed results.

Some third-party API gateways return prose, Markdown, tool-call markup, or incomplete JSON when DSH expects a review decision. This can stop a tool before it runs. The plugin handles a limited set of formatting problems and makes failed reviews easier to diagnose.

## Install

Enter **`dsh-review-format-guard@0.1.3`** in DSH's plugin manager. For a regular `dsh web` setup:

```sh
dsh plugin --profile web add dsh-review-format-guard@0.1.3 --ignore-scripts
```

For Desktop's bundled command, local archives, upgrades, and removal, see the [installation guide](INSTALL.en.md). Prebuilt archives are available in [Releases](https://github.com/MintMilk777/dsh-review-format-guard/releases/tag/v0.1.3).

Restart DSH if prompted, check that the plugin is enabled, and keep the conversation in **Auto review** mode. A simple first check is “Show the current working directory without changing any files.”

## What it does

- Recognizes supported native review requests across provider and model routes.
- Clarifies that the final tool-call record is the action awaiting review, while preserving the policy, history, source roles, and arguments.
- Validates the complete response. It can remove a whole JSON code fence, surrounding whitespace, a leading byte-order mark, and verified whitespace-only content blocks.
- Retries missing, malformed, or conflicting results within fixed limits. A valid denial is returned without retrying for an allow.
- Distinguishes stream failures such as missing conclusions, conflicting snapshots, unexpected action blocks, and missing finish events. Logs contain fixed error categories and timing, not raw conversations or replies.

The plugin uses DSH's standard plugin interface. DSH's authorization policy and permission settings remain in control.

## Waiting and failures

By default, each attempt has a 180-second total deadline, a 120-second first-content deadline, and a 30-second idle deadline after meaningful content begins. Up to three attempts can take about nine minutes plus retry delays. Explicit settings remain effective.

Cancellation, authentication failures, exhausted quota, and known invalid-request or context-window errors are not retried. Resource-limit failures allow at most two total attempts, subject to the retry setting. See [troubleshooting](docs/TROUBLESHOOTING.en.md) and [implementation details](docs/TECHNICAL.en.md) for the full behavior.

If no valid result is obtained, the review still fails. The plugin never extracts an approval from prose, reasoning, or tool-call markup.

## Compatibility

The current release was checked on Windows with DSH **0.2.2-rc.3**. It recognizes the ordered review protocol used by rc.1–rc.3 and retains the older four-section protocol. There is no DSH version-range installation block; unknown policies or request structures pass through unchanged.

See [Compatibility](COMPATIBILITY.en.md) for the tested scope. Correct JSON does not guarantee a correct authorization judgment, and retries cannot restore an unavailable upstream model.

## Development and feedback

From the source checkout, run `npm test` with Node.js 22.19.0 or newer. No dependencies, API key, or DSH installation are needed for the offline suite. Optional host checks are described in [CONTRIBUTING.en.md](CONTRIBUTING.en.md).

Report reproducible problems in [Issues](https://github.com/MintMilk777/dsh-review-format-guard/issues), with credentials and private content removed.

Initiated and maintained by MintMilk777, with development and testing assistance from OpenAI Codex.

[MIT](LICENSE). The source test fixtures retain [DeepSeek's MIT notice](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.3/fixtures/LICENSE.deepseek).
