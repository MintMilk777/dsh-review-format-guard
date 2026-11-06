## v0.1.2

Each attempt now has separate deadlines: 180 seconds total, 120 seconds for first meaningful content, and 30 seconds of idle time. Adjacent plain fragments can merge, with separate budgets for retained events, raw events, content, replay state, buffered events, and conservative memory accounting. Explicit older settings, including timeoutMs, still apply; there is no hard DSH version installation gate.

每次尝试分段等待：总期限 180 秒、首个有效内容 120 秒、内容开始后空闲 30 秒。相邻纯碎片可以合并，保留事件、原始事件、内容、重放状态、缓冲事件与保守内存计量分别受限。旧 timeoutMs 等显式配置仍生效，不设 DSH 版本硬安装门槛。

Definite failures end promptly with safe classifications and a short attempt history. Cancellation and unload stay responsive; per-read listener cleanup reduces retained waiting tasks, and close errors do not replace the primary failure. Valid denials are preserved and user cancellation is never retried. Resource-limit failures reduce the total attempt ceiling to two; other retryable failures allow at most three. If the first resource-limit failure occurs on attempt three, it ends there.

明确错误及时结束，保留安全分类和简短尝试历史。取消与卸载及时响应，每次读取后清理监听，减少等待任务积累；关闭过程的错误不覆盖主要原因。合法拒绝保留，用户取消不重试。资源超限将总尝试上限收为两次，其他可重试错误最多三次；若第三次才首次超限，直接结束。

JSON-fence removal preserves extra metadata on later fragments and removes stale signatures from modified text. Reasoning-whitespace-only fixes leave unchanged verdict fragments and their signatures intact.

移除结论的 JSON 围栏时，保留后续片段的额外元数据，并清除修改文字的旧签名；仅修正思考空白时，不合并无需修改的结论片段，也不改其签名。

Default budgets: maxBytes (retained serialized events) 256 KiB; maxChunks (raw events) 65536; maxContentBytes 256 KiB; maxReplayBytes 256 KiB; maxBufferedChunks 8192; maxMemoryBytes 4 MiB. Memory accounting is conservative, not an actual JavaScript heap ceiling.

默认预算：maxBytes（保留事件序列化体量）256 KiB；maxChunks（原始事件数）65536；maxContentBytes 256 KiB；maxReplayBytes 256 KiB；maxBufferedChunks 8192；maxMemoryBytes 4 MiB。内存采用保守计量，不是实际 JavaScript 堆内存上限。

The latest live checks through a third-party Gemini gateway produced 14 expected complete results and 3 first-content timeouts in 17 requests. Earlier 43-request success results describe only that earlier test set. The release source passed 163 offline tests and 16 isolated host checks. The release package passed 112 saved-response fragment replays and isolated installation/removal checks. See [test scope and limits](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.2/COMPATIBILITY.en.md).

最新 third-party Gemini gateway 实测共 17 次请求：14 次完整结果符合预期，3 次首内容超时。此前 43 次正常仅描述当时测试集；发布源码通过 163 项离线测试和 16 项独立宿主检查；发布包通过 112 次保存返回的分片回放，以及隔离安装卸载检查。见[测试范围与限制](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.2/COMPATIBILITY.md)。

Install **dsh-review-format-guard@0.1.2** through DSH's plugin manager, or use **dsh-review-format-guard-0.1.2.tgz**. **dsh-review-format-guard-source-v0.1.2.zip** is the source archive; compare downloads with **SHA256SUMS.txt**. [English installation guide](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.2/INSTALL.en.md).

通过 DSH 插件管理器安装 **dsh-review-format-guard@0.1.2**，或使用 **dsh-review-format-guard-0.1.2.tgz**。**dsh-review-format-guard-source-v0.1.2.zip** 为源码附件，下载后与 **SHA256SUMS.txt** 核对。[中文安装指南](https://github.com/MintMilk777/dsh-review-format-guard/blob/v0.1.2/INSTALL.md)。

Formatting checks do not guarantee correct authorization judgments. Retries may add latency and cost; these test sets do not estimate an overall failure rate.

格式校验不保证授权判断正确。重试可能增加等待与费用；这些测试集不能用于估计总体故障率。

Initiated and maintained by MintMilk777, with development and testing assistance from OpenAI Codex.

由 MintMilk777 发起并维护，使用 OpenAI Codex 协助开发与测试。
