# 安装、试用和卸载

[English](INSTALL.en.md) · [首页](README-zh-CN.md) · [排查问题](docs/TROUBLESHOOTING.md)

此页对应插件 v0.1.0，安装实测环境为 Windows / DSH 0.2.1-rc.3。其他版本的情况见[兼容范围](COMPATIBILITY.md)。

## 下载

在 [v0.1.0 发布页](https://github.com/MintMilk777/dsh-review-format-guard/releases/tag/v0.1.0)下载 `dsh-review-format-guard-0.1.0.tgz`，保持原文件，不要解压。`SHA256SUMS.txt` 用来核对附件的完整性。

## 方法一：使用插件页面

1. 打开 DSH 插件页面，选择“添加插件 / 安装第三方插件”，具体名称可能随版本变化。
2. 填写 npm 包名 **`dsh-review-format-guard`**。也可以填写下载的 `.tgz` 文件的完整路径，或[安装包直链](https://github.com/MintMilk777/dsh-review-format-guard/releases/download/v0.1.0/dsh-review-format-guard-0.1.0.tgz)。
3. 核对包信息并确认安装。按提示重启，确认 `dsh-review-format-guard` 已启用。

如果你的版本不接受包名或安装包路径，可使用下面的自带命令。

## 方法二：Windows 自带命令

先启动过一次 DSH，让桌面配置完成初始化，然后**完全退出 DSH**。找到 `DeepSeek Harness.exe` 所在文件夹，在那里打开 PowerShell，使用桌面版自带的命令，不要换成另外通过 npm 安装的 dsh。

```powershell
& "./resources/runtime/cli/bin/dsh.cmd" plugin --profile desktop add dsh-review-format-guard --ignore-scripts
```

若使用下载的安装包，把命令中的 `dsh-review-format-guard` 换成带引号的安装包完整路径。

`desktop` 表示桌面版使用的插件配置；`--ignore-scripts` 表示不运行包的安装等附加脚本，本插件也不需要这些脚本。自带命令已包含所需运行时，不必为此另外安装 Node.js。

路径不存在时，请核对 DSH 的实际安装位置，不要手工覆盖内置组件。

## 其他部署方式

使用与你当前宿主对应的命令入口，例如 Web 配置：

```sh
dsh plugin --profile web add dsh-review-format-guard --ignore-scripts
```

把 `web` 换成你真正使用的配置。只在其他文件夹运行普通的 `npm install`，不会自动把插件挂载到 DSH。

## 安装后怎么确认？

重新打开 DSH，确认插件已启用，会话底部仍是“自动审查”。先试一句“只查看当前工作目录，不修改文件”。“完全权限”下工具执行成功，并不能证明自动审查经过了插件。

仍然失败时保留错误码，按[排查说明](docs/TROUBLESHOOTING.md)检查。高风险场景只用虚构描述在独立进程中分类测试，不在真实会话里尝试危险动作。

## 停用

在 DSH 插件页关闭本插件，按提示重启。DSH 卸载监听器后，插件会取消在途尝试，之后恢复原处理流程；原服务的格式问题可能再次出现。

## 卸载

完全退出 DSH，在它的安装文件夹运行：

```powershell
& "./resources/runtime/cli/bin/dsh.cmd" plugin --profile desktop remove dsh-review-format-guard --ignore-scripts
```

其他配置使用对应入口，例如：

```sh
dsh plugin --profile web remove dsh-review-format-guard --ignore-scripts
```

随后重新打开 DSH。移除本插件不会卸载内置自动审查。

## 核对下载文件（可选）

```powershell
Get-FileHash -Algorithm SHA256 "C:/path/to/dsh-review-format-guard-0.1.0.tgz"
```

把结果与同一发布页的 `SHA256SUMS.txt` 对照，文件名也要一致。
