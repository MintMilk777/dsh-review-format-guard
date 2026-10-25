# Install, check, and uninstall

[中文](INSTALL.md) · [Home](README.md) · [Troubleshooting](docs/TROUBLESHOOTING.en.md)

These instructions cover plugin v0.1.0. The tested desktop setup is DSH 0.2.1-rc.3 on Windows. Other versions are discussed in [Compatibility](COMPATIBILITY.en.md).

## Download

Download [dsh-review-format-guard-0.1.0.tgz](https://github.com/MintMilk777/dsh-review-format-guard/releases/download/v0.1.0/dsh-review-format-guard-0.1.0.tgz) from the release page. Keep the file as `.tgz`; do not unpack it. `SHA256SUMS.txt` contains the checksums for the attached plugin and source archives.

## Option 1: DSH's plugin page

1. Open DSH's plugin page and choose **Add plugin / Install a third-party plugin**. Labels can vary by DSH version.
2. Enter the npm package name **`dsh-review-format-guard`**. You can also use the absolute path to the downloaded `.tgz`, or the [direct archive URL](https://github.com/MintMilk777/dsh-review-format-guard/releases/download/v0.1.0/dsh-review-format-guard-0.1.0.tgz).
3. Review the package details and confirm installation. Restart if DSH asks you to, then check that `dsh-review-format-guard` is enabled.

If your version's dialog does not accept the package name or archive, use the bundled command below.

## Option 2: Windows bundled command

Open DSH once to initialize its desktop profile, then **fully quit it** before using its command-line plugin manager. Find the folder containing `DeepSeek Harness.exe` and open PowerShell there. Use DSH's own `resources/runtime/cli/bin/dsh.cmd`, rather than a separately installed npm copy of `dsh`.

```powershell
& "./resources/runtime/cli/bin/dsh.cmd" plugin --profile desktop add dsh-review-format-guard --ignore-scripts
```

To install a downloaded archive instead, replace `dsh-review-format-guard` with its quoted absolute file path.

The `desktop` profile is the desktop app's plugin setup. `--ignore-scripts` tells the package manager not to run package lifecycle scripts; this plugin needs none.

If the command file is missing, check your DSH installation path instead of editing its internal packages. Desktop's bundled command includes the runtime it needs.

## Other profiles

For a non-desktop setup with the matching `dsh` command available:

```sh
dsh plugin --profile web add dsh-review-format-guard --ignore-scripts
```

Replace `web` with the profile you actually run. A normal `npm install` in an unrelated directory does not mount a plugin in DSH.

## Check that it works

Reopen DSH. Confirm the plugin is enabled and the conversation is in **Auto review**, then try “Show the current working directory without changing any files.” A tool succeeding in Full access mode does not exercise auto-review and is not a useful check.

If it still fails, save the error code and use the [troubleshooting guide](docs/TROUBLESHOOTING.en.md). Use fictional inputs in an isolated process for high-risk test cases; do not try dangerous actions in a live conversation.

## Disable

Turn the plugin off on DSH's plugin page and restart if requested. Once DSH unloads it, active plugin attempts are cancelled and later requests follow the original path. The provider's format problem may return.

## Uninstall

Fully quit Desktop, then run this from its installation folder:

```powershell
& "./resources/runtime/cli/bin/dsh.cmd" plugin --profile desktop remove dsh-review-format-guard --ignore-scripts
```

For another profile, use its matching command, for example:

```sh
dsh plugin --profile web remove dsh-review-format-guard --ignore-scripts
```

Reopen DSH afterward. This removes this plugin, not the built-in auto-review component.

## Verify a download (optional)

```powershell
Get-FileHash -Algorithm SHA256 "C:/path/to/dsh-review-format-guard-0.1.0.tgz"
```

Compare the result with the matching filename in the release's `SHA256SUMS.txt`. Download the checksum file and archive from the same release.
