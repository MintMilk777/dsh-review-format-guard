# 出问题时怎么判断？

[English](TROUBLESHOOTING.en.md) · [安装指南](../INSTALL.md)

先确认 DSH 版本、插件版本，以及当前会话是否为“自动审查”。插件只处理已支持的原生审查请求；完全权限下的工具执行成功不能作为验证证据。

| 情况 | 可能含义与下一步 |
|---|---|
| 找不到 dsh 命令 | 按 [Windows 指南](../INSTALL.md)使用当前 DSH 自带的入口 |
| 原 JSON 报错且没有插件前缀 | 检查是否已启用、装错配置、未重启、政策版本未知或使用其他审批流程；仅缺少前缀不能证明未安装 |
| Review format guard: after 3 attempt(s) | 已处理并重试，结果仍不合格；反馈脱敏错误与复现条件 |
| REVIEW_JSON_INVALID / REVIEW_SCHEMA_INVALID | 结论不完整或字段不符；不要从普通文字中手工截出允许结论 |
| REVIEW_STREAM_INVALID | 返回结构或副本不一致；提供接口类型与最小虚构样例 |
| 等待较久或出现超时 | 每次默认总期限 180 秒、首内容等待 120 秒、开始后无新有效内容 30 秒；最多三次最坏约 9 分钟加退避等待，详见[等待与重试](TECHNICAL.md#等待与重试) |
| 合法拒绝 | 按 DSH 原有流程处理，插件不会为了取得允许而重试 |
| 工具执行后报错 | 检查工具、路径和运行环境，不能只归因于返回格式 |

## 错误分类

表中“有限重试”均受 `retries` 限制，默认最多重试两次，含首次共三次。合法拒绝完整校验后一次结束，不重试；资源超限采用下表中更低的次数上限。取消或卸载会停止当前等待和后续重试。

| 错误码 | 是否重试及处理 |
|---|---|
| `REVIEW_TIMEOUT` | 有限重试。单次总期限、首内容或空闲期限到期；安全错误说明会指出阶段。检查是否显式保留了较短的 `timeoutMs` |
| `REVIEW_CANCELLED` | 不重试。请求取消或插件卸载 |
| `REVIEW_JSON_INVALID`、`REVIEW_SCHEMA_INVALID`、`REVIEW_DUPLICATE_KEYS`、`REVIEW_TEXT_MISSING` | 有限重试。结论缺失、JSON 不完整、字段不符或重复；不要手工拼凑允许结论 |
| `REVIEW_STREAM_INVALID` | 受 `retries` 限制，最多三次。固定分类会区分动作块（`action-block`）、快照冲突（`snapshot-conflict`）、缺少最终正文（`missing-conclusion`）、多个正文块（`block-order`）、输出截断（`output-limit`）及缺少结束信号（`missing-finish`）等情况；未知原因仍只给出通用错误。成功仍须完整校验，不会从思考或工具调用中拼出允许结论 |
| `REVIEW_SIZE_LIMIT` | 资源超限后最多共尝试两次，受 `retries` 限制（0 为一次，1 最多两次）；若前两次是其他错误、第三次才首次超限，则直接结束。安全说明会指出触及的预算，见[流缓冲预算](TECHNICAL.md#流缓冲预算) |
| `REVIEW_UPSTREAM_UNSUPPORTED_REASONING_EFFORT` | 不重试。当前通道不支持请求的思考档位。DSH 可在本机以 `UNSUPPORTED_REASONING_EFFORT` 拒绝不支持的 `reasoningEffort=max` 调用，尚未发出网络请求。核对通道能力与调用设置；插件不会静默降档、换模型或改写模型的审查判断 |
| `REVIEW_UPSTREAM_AUTH` | 不重试。认证失败或凭据无效、缺失；检查服务配置，不要公开凭据 |
| `REVIEW_UPSTREAM_QUOTA`、`REVIEW_UPSTREAM_ACCOUNT_QUOTA` | 不重试。服务或账号额度耗尽；检查可用额度 |
| `REVIEW_UPSTREAM_CONTEXT_WINDOW_EXCEEDED`、`REVIEW_UPSTREAM_INVALID_REQUEST` | 不重试。输入超出服务可接受的上下文长度，或请求无效；缩减输入或修正请求后再试 |
| `REVIEW_UPSTREAM_RATE_LIMIT`、`REVIEW_UPSTREAM_TIMEOUT`、`REVIEW_UPSTREAM_SERVER` | 有限重试。服务明确报告临时限流、超时或服务器故障；持续失败时检查服务状态 |
| `REVIEW_UPSTREAM_TRANSPORT`、`REVIEW_CONNECTION_FAILURE` | 有限重试。前者是服务明确报告的网络或传输故障，后者是异常中识别到的已知连接错误码 |
| `REVIEW_UPSTREAM_EMPTY_RESPONSE` | 有限重试。服务明确报告空响应 |
| `REVIEW_UPSTREAM_FAILURE`、`REVIEW_STREAM_FAILURE` | 不重试。前者是未分类的服务失败，后者是未分类的流异常；需要进一步定位，不能仅凭错误文字认定为临时网络问题 |

`usage` 用量统计、空白和重复快照不续期。有效文字或思考内容只重置空闲期限，总期限不续期。显式设置的旧 `timeoutMs` 仍然生效；完整规则见[技术说明](TECHNICAL.md#等待与重试)。

插件日志记录请求序号、尝试次数、规范化状态、安全错误码与毫秒耗时，不保存会话、模型回复或上游错误原文。失败尝试的简短历史会写入后续成功日志和最终失败说明；JSON 解析错误还可包含固定的返回形态分类。这些诊断能缩小范围，不能单独证明上游忽略系统提示或模型判断正确。

在 Issues 中填写版本、系统、接口类型与脱敏错误。服务入口可用 provider-a 代称，不需要公开地址。不要贴密钥、认证请求头、Cookie、完整会话或真实待审参数。

当前验证过的 DSH 重启时可能改变会话模式，请查看底部模式后按 DSH 界面恢复所需模式；插件本身不修改权限模式。

安装包不按 DSH 版本号拦截安装，但未知政策仍会原样转发。如果能安装却没有效果，先对照[兼容说明](../COMPATIBILITY.md)。新发布 npm 包若被等待期策略拦住，应按实际错误排查，不要为了绕过它关闭全局保护。
