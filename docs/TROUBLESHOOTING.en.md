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
| `REVIEW_UPSTREAM_FAILURE` | Check service availability and authentication. Only selected temporary failures are retried. |
| A valid denial | DSH handles it through its usual review/approval flow. The plugin does not retry just to obtain an allow. |
| The tool ran, then failed | Investigate the tool, path, and environment. That is a different stage from review response parsing. |

The package has no hard DSH version-range check, but unfamiliar policies are passed through unchanged. See [Compatibility](../COMPATIBILITY.en.md) if a different host version installs successfully but the plugin has no effect.

Logs report codes, response shape, and character counts, not raw answers. Those details help narrow a problem; they do not prove what a gateway does internally.

Use [Issues](https://github.com/MintMilk777/dsh-review-format-guard/issues) and include versions, OS, API type, steps, and redacted errors. Replace private provider names with labels such as `provider-a`. Do not post keys, authorization headers, cookies, full conversations, or real pending-action parameters. Keep high-risk examples fictional and isolated from tool execution.

Some tested DSH behavior changes the conversation's permission mode after restart. Check it in the UI; this plugin does not change that mode.
