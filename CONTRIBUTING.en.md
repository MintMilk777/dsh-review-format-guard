# Contributing and validation

[中文](CONTRIBUTING.md) · [Home](README.md)

Bug reports, small reproducible examples, and focused code reviews are welcome. Describe what happened and what you expected. Keep format compatibility separate from changing authorization decisions.

## Offline tests

Use Node.js 22.19.0 or newer and run from the source checkout:

```sh
npm test
```

There are 51 tests, including 882 field/type combinations and 2,000 deterministic malformed inputs. The combinations are part of those tests, not additional totals. No dependency install, DSH installation, credentials, or model calls are needed. GitHub Actions runs the offline suite on Windows and Ubuntu with Node.js 22 and 24.

## Optional host integration checks

For a supported Windows DSH installation, set the paths without surrounding quote characters:

```powershell
$env:DSH_EXECUTABLE = Read-Host "Full path to the DSH executable"
$env:DSH_ARCHIVE = Read-Host "Full path to resources/app.asar"
npm run test:host
```

The script uses Electron's isolated Node mode and the real Cordis, BlockAssembler, and review parser. It verifies that the installed policy matches the snapshot. It does not open a chat, call a remote model, register a tool executor, or change DSH configuration. These environment variables apply to the test process. `REVIEW_GUARD_ENTRY` can point at an installed or unpacked plugin entry.

## Preserve these behaviors

- Ordinary chat and unknown policies keep the original request path.
- Valid denials are returned without retries to obtain an allow.
- Missing or conflicting conclusions, duplicate fields, and malformed streams cannot become approvals.
- Retry attempts re-enter the normal LLM chain and obey count, size, time, and cancellation limits.
- Unload stops active attempts and removes the listener.
- Tests and logs contain no real credentials or private conversation content.

## Model tests and version claims

Use your own isolated test setup with fictional inputs and no tool executor. High-risk actions must remain descriptions, not actions submitted to a live conversation. Record failures and retry counts as well as successes, together with host, plugin, interface, and model-route names. Service-reported names do not verify model identity.

Distinguish source comparisons from installation and integration tests when proposing support for another host version. See [Compatibility](COMPATIBILITY.en.md) for the current evidence.
