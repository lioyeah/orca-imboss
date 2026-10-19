# 005 — `tool_calls` 清洗 + 400 重试：上游 PR 规格

- 作者：employee 6（运维工程师 / SRE）
- 委派：@0（消息 id 135，2026-10-19）
- 服务目标：老板「产出可向上游 PR 的功能」——本文只写规格，不含实现代码、不建分支、不提交 `src/`
- 关联事故文档：`scripts/private/ops/004-employee4-session-poison.md`（commit `b1db16d`）
- 行号勘误：004 文档与 id 129 report 中引用的 `4.jsonl:123/125/126` 有偏移，本文件以复验后的**准确行号**为准（见 §1.2），后续引用请以本文件为准。

---

## 0. TL;DR

| 问题 | 答案 |
| --- | --- |
| 根因是否成立 | 成立。一条 `function.name === ""` 的 assistant tool call 被原样持久化、原样回传，provider 每次都以 `400 invalid_request_error` 拒绝，会话无自愈 |
| 修在 app 还是 SDK | **两侧都要，但 app 侧可独立交付**：app 侧 `before_provider_request` 扩展点即可完成「请求组装时清洗」，这是本次 PR 的主体 |
| 升级 `pi-agent-core@1.2.0` 能修吗 | **不能**。1.0.4→1.2.0 的唯一改动是工具执行遥测（`durationMs`），无任何 sanitize/retry（§3） |
| 为什么 PR-ready | 改动落在 `src/main/agent/`，不 import `src/renderer/private/`、无私有层依赖、可从 `main` 干净 cut（§5，AGENTS.md §1） |
| 附带收益 | 修复上线后，**已被毒化的会话（含 @4 的 `4.jsonl`）在下一次请求即可自愈，无需编辑会话文件**（§4.4） |

---

## 1. 问题陈述

### 1.1 一句话

模型在一次回合里发出了一个 `name` 为空的 tool call；运行时把它当作普通消息写进历史且不清洗；此后每一次 provider 请求都回放这条畸形 `tool_calls`，被 StepFun 以 `tool_calls.function.name is required` 拒绝，**回合在 provider 请求校验阶段就失败（0 token、~1.4s），会话永久失能且无任何自愈路径**。

### 1.2 证据（`/home/ilio/.imboss/agent/sessions/chats/11/4.jsonl`，行号已复验）

| 行 | 时间 (UTC) | 内容 |
| --- | --- | --- |
| L119 | 2026-10-18T04:00:21.893Z | @4 最后一次正常回合（`stopReason=toolUse`，usage 1183/1545） |
| L124 | 2026-10-18T04:03:23.096Z | **毒化源**：assistant 消息，`content` 含两个 toolCall：`('bash','chatcmpl-tool-9514387ab685a2b2')` 与 `('', 'call_18df83e6959c779000000001')`；后者 `name` 为空、`arguments` 为 `{}`，且 id 前缀 `call_` 与正常调用的 `chatcmpl-tool-` 不同（说明是 provider 侧产出的结构性畸形调用） |
| L125 | 04:03:23.131Z | bash 的 toolResult，`isError=false` |
| L126 | 04:03:23.131Z | 空名 toolResult：`toolName=''`、`isError=true`、`text="Tool  not found"`（注意名字里的双空格，即 `Tool ${name} not found` 的 `name` 为空串） |
| L127 | 04:03:24.346Z | **首个 400**：assistant `stopReason="error"`，`usage` 全 0，`errorMessage` = `400: {"code":null,"message":"StepFun (China): tool_calls.function.name is required","param":null,"type":"invalid_request_error"}`，`content: []` |
| L129 | 2026-10-18T09:21:42.047Z | user 唤醒（ping，消息 id 107） |
| L130 | 09:21:43.806Z | 同一 400 复现（1.76s） |
| L132 | 2026-10-18T23:36:33.471Z | user 唤醒（notify，消息 id 115） |
| L133 | 23:36:34.846Z | 同一 400 复现（1.37s） |

文件 mtime = 2026-10-19 07:36:34.845 +0800 = L133 的失败回合，即「文件在被写、聊天零产出」的成因。

### 1.3 为什么是「永久」毒化（机制链）

请求组装路径（版本 `@earendil-works/pi-agent-core@1.0.4`，路径见 §4.1）：

1. `dist/agent-loop.js:79` `runLoop` 每轮先调 `config.prepareRequest?.({ context, model, thinkingLevel })`（agent-loop.js:123-137）——**这是唯一一个「请求发出前可改 context」的官方钩子，app 当前没有使用**。
2. `agent-loop.js:260-334` `streamAssistantResponse`：`context.messages` → `config.convertToLlm(messages)` → `streamFunction(model, llmContext, options)`。**没有任何一步校验/清洗 tool call 的 name。**
3. `agent-loop.js:308-321`：provider 返回 error 事件时，把 `finalMessage`（`stopReason="error"`、`errorMessage` 为 400 文本、`content: []`）**push 进 `context.messages`** —— 错误消息也进历史。
4. pi-ai 侧 `dist/api/openai-completions.js:271-275` 发起请求；`retryProviderRequest`（`dist/utils/provider-retry.js`）的 `isRetryableProviderError` 只重试 **408/409/429/5xx**（以及 `x-should-retry` 头），**400 不在重试集合**。
5. `openai-completions.js:491-513` catch：置 `stopReason="error"`、`errorMessage=formatProviderError(...)`，推 `error` 事件后 `stream.end()` —— **不抛异常、不重试、不回滚历史**。

于是：畸形 tool call 留在历史 → 下一轮原样回放 → 400 → 错误消息也进历史 → 再下一轮原样回放 → 400……循环不靠任何外部干预无法打破。通知送达、会话唤醒、模型回合调度全部正常，唯独「provider 请求校验」这一跳必败，这就是 20 小时静默的完整解释。

### 1.4 影响面

- **个体故障**：全 fleet 扫描 `/home/ilio/.imboss/agent/sessions/chats/*/*.jsonl`，空名 tool call 仅此 1 条；error-turn 计数 1/2/3/5/6 号会话均为 0，仅 4 号 3 次。
- **潜在基础设施风险**：6 个员工同一模型同一 provider，任一 agent 产出一次畸形 tool call 即可永久毒化其会话；系统层无僵尸进程、内存/磁盘/负载健康（详见 004 文档）。
- 已有 near-miss：`4.jsonl:104-105` 的 `imb_read_chat` 参数校验失败（缺 `chatId`）因调用本身合法而恢复——说明「工具调用畸形」不是孤例，只是那一次没打到 provider 校验上。

---

## 2. 修复目标

1. **请求组装时清洗**：任何发往 provider 的请求，都不得包含 `function.name` 为空/空白的 assistant tool call，也不得包含其孤立的 `role:"tool"` 结果。
2. **失败时清洗+重试一次**：遇 `400 invalid_request_error` 且报错文本指向 `tool_calls` 时，先清洗再重试一次（有上限、有日志、可观测）。
3. **毒化可检测**：连续失败回合能被打上「会话毒化」标记并暴露出来，不再静默 20 小时。
4. **已毒化会话可自愈**：修复对历史里的毒同样生效（下次请求即清），不需要手工编辑会话文件。

---

## 3. 疑点查实：`pi-agent-core@1.2.0` 是否已修？

**结论：未修。升级依赖不能解决本问题，PR 必须是新功能。**

证据（只读比对，路径逐字）：

- `node_modules/.pnpm/@earendil-works+pi-agent-core@1.0.4_@aws-sdk+credential-provider-node@3.972.84_@smithy_786f3125d50ad068d874c74a9cd9e372/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js`（667 行）
- `node_modules/.pnpm/@earendil-works+pi-agent-core@1.2.0_@aws-sdk+credential-provider-node@3.972.84_@smithy_40745a3a89966e85bbdc2fd21c26313e/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js`（675 行）

diff 显示**唯一改动是工具执行遥测**：新增 `startedAt = performance.now()`、`elapsed()`，`durationMs` 贯穿 `executePreparedToolCall` 返回值、`createToolResultMessage` 与 finalized-call 事件。两版本中

```
agent-loop.js:486   result: createErrorToolResult(`Tool ${toolCall.name} not found`),
```

逐字节相同——`prepareToolCall`（agent-loop.js:481）对未知/空 name 仍立即产出 error toolResult，且**不把畸形调用从历史里摘掉**。无 sanitize、无 repair、无 retry。

旁证：

- pi-ai `dist/api/anthropic-messages.js` 的 `sanitizeSurrogates` 只处理 unicode 代理对，与 tool call name 无关；1.0.4 与 1.2.0 相同。
- `dist/utils/provider-retry.js` 的 `isRetryableProviderError` 只覆盖 408/409/429/5xx，400 结构性拒绝不在重试集合（1.0.4 与 1.2.0 相同，待验：1.2.0 的 provider-retry 是否与 1.0.4 逐字节相同——本次未单独 diff 该文件）。
- app 实际解析到 `@earendil-works/pi-agent-core@1.0.4`（`node -e "console.log(require('@earendil-works/pi-agent-core/package.json').version)"` → `1.0.4`）；`package.json` 声明 `"@earendil-works/pi-coding-agent": "^1.0.4"`。

---

## 4. 修复方案

### 4.1 分层与可选挂钩点（已取证）

| 层 | 文件:行 | 能力 | 能否重试 |
| --- | --- | --- | --- |
| agent 主循环 | `pi-agent-core/dist/agent-loop.js:123-137`（`prepareRequest`，每轮请求前，可返回新 `context`） | 清洗 `AgentMessage[]` | 否（400 要到请求回来才知道） |
| 扩展钩子 | `pi-coding-agent/dist/core/sdk.js:263` `onPayload: transformProviderPayload` → `dist/core/extensions/runner.js:1066` `emitBeforeProviderRequest`（handler 返回值非 `undefined` 即替换 payload，可链式） | 清洗/替换最终 provider payload（OpenAI 格式 `messages`/`tools`） | 否 |
| provider 适配器 | `pi-ai/dist/api/openai-completions.js:188`（`options.onPayload` 可返回 `nextParams` 替换 params）；`:271-275` 发起请求；`:491-513` catch | **清洗 + 重试都在这里最自然** | 是 |
| 重试器 | `pi-ai/dist/utils/provider-retry.js` `retryProviderRequest` / `isRetryableProviderError` | 现成重试骨架，但策略不含 400 | 是 |

app 侧接线现状（只读取证）：`src/main/agent/session.ts:517` 已通过 `extensionFactories: [mcpExtension]` 注册内置扩展，`src/main/agent/session.ts:520-533` 调 `pi.createAgentSession({ cwd, agentDir, modelRuntime, model, thinkingLevel?, customTools, resourceLoader, sessionManager, settingsManager })`。`createAgentSession` 的 options **不暴露** `prepareRequest`/`streamFn`，因此：

- **app 今天就能做的**：新增一个扩展工厂（与 `mcpExtension` 并列）注册 `before_provider_request` handler → 完成 §2 目标 1 与目标 4。这是本 PR 的 app 侧主体，零 SDK fork。
- **需要 SDK/上游配合的**：`openai-completions.js` catch 内的「清洗后重试一次」（§4.3）。app 侧可用「下一轮自愈 + 主动补发」近似（§4.5）。

### 4.2 清洗算法（Fix A，app 侧，上游干净）

挂钩点：扩展 `before_provider_request`，收到 OpenAI chat-completions 形状的 `params`（`model` / `messages` / `tools` / `tool_choice` / …）。

```
输入: params（不得原地修改）
输出: 新 params 对象；无改动时返回 undefined（让 SDK 用原对象，避免无意义拷贝）

validNames = { t.function.name for t in (params.tools ?? []) if t.type === "function" }
droppedCalls = []; droppedToolMsgs = []

newMessages = []
liveToolCallIds = {}          # tool_call_id -> 所属 assistant 消息序号（仅本 payload 内）
for m in params.messages:
    if m.role == "assistant" and Array.isArray(m.tool_calls):
        kept = []
        for tc in m.tool_calls:
            name = (tc.function?.name ?? "").trim()
            if name == "":                      droppedCalls.append((tc.id, "empty_name")); continue
            if params.tools is non-empty and name not in validNames:
                                              droppedCalls.append((tc.id, "unregistered")); continue
            kept.append(tc); liveToolCallIds[tc.id] = len(newMessages)
        if kept.length == len(m.tool_calls):    newMessages.append(m)          # 未改动，原样
        elif kept.length > 0:                   newMessages.append({...m, tool_calls: kept})
        else:                                   # tool_calls 全被清洗掉
            if m.content is non-empty:          newMessages.append({...m, tool_calls: undefined})
            else:                               pass                            # 丢弃整条空 assistant 消息
    elif m.role == "tool":
        if m.tool_call_id not in liveToolCallIds:
            droppedToolMsgs.append(m.tool_call_id); continue                   # 孤立 tool 结果
        newMessages.append(m)
    else:
        newMessages.append(m)

if 什么都没丢: return undefined
log("tool_call_sanitized", { droppedCalls, droppedToolMsgs, messageCount: len(params.messages) -> len(newMessages) })
return { ...params, messages: newMessages }
```

设计约束（写进 PR description 的要点）：

1. **幂等**：同一 payload 重复清洗结果相同（第二次返回 `undefined`）。这是「清洗+重试一次」不炸的前提。
2. **不可变**：返回新对象/新数组，绝不原地改 `params`；`before_provider_request` 的 handler 是被链式调用的（runner.js:1066-1076），原地改会污染其他 handler 与 SDK 内部状态。
3. **`unregistered` 规则要保守**：仅当 `params.tools` 非空时才按注册表过滤。原因：`tool_search` 等 deferred 暴露模式下声明表可能不包含全部可调工具（`pi-coding-agent` 的 `EXPOSURE_DESCRIPTIONS` 语义），激进过滤会把合法调用全删掉。→ **待验**：本 app 的 builtin + MCP + `imb_*` 工具是否全部出现在 `params.tools`（可在灰度期先只开 `empty_name` 规则，`unregistered` 规则加开关默认关）。
4. **只动线上 payload，不动会话历史**：历史文件（jsonl）保持原样留证；`parentId/id` 链不受影响，内存态与磁盘态不会分叉。这正好规避 004 文档里「手工编辑 4.jsonl 有 live 风险」的结论。
5. **日志/可观测**：每次真实清洗打一条结构化日志（含被丢弃的 `tool_call_id` + 原因 + 前后 message 数），并计数暴露（见 §4.4）；**不得**把 tool arguments 全量打进日志（可能含敏感内容），只打 id/name 长度/原因。

### 4.3 清洗 + 400 重试一次（Fix B，上游 PR 给 `@earendil-works/pi-ai`）

挂钩点：`pi-ai/dist/api/openai-completions.js` 的 IIFE try 块内（现 :194-199 发起请求处）与 catch（现 :491-513）。

```
sanitizeRetried = false            # 单次 stream 生命周期内的循环闸门
try {
    ...
    let params = buildParams(...)
    params = (await sanitizeToolCallParams(params)) ?? params      # 复用 Fix A 的纯函数
    const send = () => client.chat.completions.create(params, requestOptions).withResponse()
    let result
    try {
        result = await retryProviderRequest(send, { maxRetries, maxRetryDelayMs, signal })
    } catch (err) {
        if (!sanitizeRetried && isToolCallsShapeError(err)) {      # 见下方判定
            const cleaned = await sanitizeToolCallParams(params)
            if (cleaned !== undefined) {
                sanitizeRetried = true
                params = cleaned
                log("tool_calls_400_sanitize_retry", { attempt: 2, error: classify(err) })
                result = await retryProviderRequest(send, { maxRetries: 0, signal })   # 重试只此一次
            }
        }
        if (result === undefined) throw err
    }
    const { data: openaiStream, response } = result
```

判定函数：

```
isToolCallsShapeError(err):
    status = err?.status ?? err?.response?.status
    if status !== 400: return false
    text = String(err?.message ?? "") + String(err?.error?.message ?? "")
    return /tool_calls/i.test(text) and /(name|required|invalid)/i.test(text)
```

- **重试上限**：每个 stream 生命周期最多 1 次（`sanitizeRetried` 闸门）；重试本身走 `maxRetries: 0`，不再叠 provider 通用重试，避免 400 × 通用重试的放大。
- **不重试的情形**：清洗后 payload 无变化（说明 400 不是 tool_calls 形状问题，重试无意义且会烧配额）；`signal.aborted`（视为用户中断）。
- **失败路径不变**：重试仍失败则走原 catch，`stopReason="error"` + `errorMessage` 保持现状（下游看门狗靠这个信号）。
- **可观测**：`tool_calls_400_sanitize_retry` 日志带 `{ provider, model, sessionId?, dropped: [...], attempt: 2, outcome }`；建议同时导出一个 counter（`provider_toolcall_sanitize_retry_total{provider,model,outcome}`）。
- **其他 api 适配器**：`anthropic-messages.js` / `openai-responses.js` / `google-*.js` / `bedrock-converse-stream.js` 等是同一模式的副本。PR 范围建议**首版只做 `openai-completions`**（本次事故路径，也是本 app 实际使用的 api：证据 `4.jsonl` 中 `api: "openai-completions"`），其余适配器在 PR description 里列为 follow-up，避免一个 PR 摊太大。

### 4.4 看门狗（会话毒化检测）

**检测规则**（每个 `(employee, chat)` 会话独立计数）：

```
poisoned(session) :=
    连续 >= 2 个回合，每个回合都满足:
        message.stopReason == "error"
      & usage.input == 0 and usage.output == 0 and usage.totalTokens == 0
      & 回合时长 < 2s（上一轮结束到本轮结束）
      & errorMessage 匹配特征串 /tool_calls\.function\.name is required/（或更宽: /tool_calls/i + /invalid_request_error/）
```

- 特征串（逐字）：`tool_calls.function.name is required`；放宽版同时要求 `type":"invalid_request_error"`。
- 任一回合成功（`stopReason != "error"` 或 usage 非 0）即清零计数。
- **挂钩点**：app 侧 `src/main/agent/session.ts:535` 起的 `session.subscribe((event) => …)` 已经拿到**原始** `AgentSessionEvent`（含 `turn_end` 的 `message`），所以看门狗可以完全留在 main 进程；注意 `src/main/agent/agent-events.ts` 的 `toStreamEvent` 白名单**丢弃**了 `turn_end` 携带的 message（只转发 `{type:"turn_end"}`），因此不要把看门狗做在渲染层 DTO 上——要么在 main 进程订阅处做，要么扩白名单（扩白名单会把完整 message 推过 IPC，需评估体积，倾向前者）。
- **暴露**：① 结构化日志 `session_poison_detected { employeeId, chatId, sessionFile, errorTurns, signature }`；② 内存/DB 里的 per-session 健康标记，供运维视图/健康检查读取；③ 首次触发时打 warning，之后每 N 次打一次（避免刷屏）。
- **动作分级**（建议，交 orchestrator 决定）：
  - L1 仅标记+告警（零风险，首版就做）；
  - L2 自动补发一次唤醒（`src/main/agent/session-queue.ts` 的 `wakeAgent`/`deliver`）——注意：若 Fix A 未上线，补发只会再失败一次，所以 L2 必须与 Fix A 同批上线；
  - L3 自动归档会话开新会话——**涉及 app 层写操作，不在本 PR 范围**（红线：SRE 只给建议）。

### 4.5 app 侧「无 SDK 改动」的自愈路径（Fix A 的直接收益）

因为毒是**每轮请求都被重新回放**的，Fix A 在请求组装处清洗后：

- @4 的 `4.jsonl`（含 L124/L126/L127/L130/L133 全套毒）在**下一次请求**就会被清掉畸形 tool call，会话立即恢复，**不需要归档、不需要编辑 jsonl、不需要重启 app**。这直接推翻 004 文档里「唯一恢复路径是归档开新会话」的结论（前提：Fix A 上线且清洗规则覆盖 `empty_name`）。
- 残留的历史错误消息（L127/L130/L133：`stopReason="error"`、`content: []`、无 tool_calls）会被 `convertToLlm` 转成普通 assistant 消息。→ **待验**：空 content 的 assistant 消息在 StepFun/magpie 与 OpenAI 上是否被接受；若被拒，Fix A 需追加一条规则「丢弃 `content` 为空且无 tool_calls 的历史 assistant 消息」（同样只动线上 payload）。建议在验收里专门覆盖这条。

---

## 5. 为什么适合 `feat/*` 分支（AGENTS.md §1）

AGENTS.md §1 分支模型：`feat/*`/`fix/*` **从 `main` cut**，**不得 import 或依赖 `src/renderer/private/` 任何内容**；若需私有审美先在 `mine` 开发，开上游 PR 前干净重切回 `main`。

本 PR 满足：

1. **改动面在 `src/main/agent/`（主进程，非渲染层）**：新增一个扩展工厂（如 `src/main/agent/toolcall-sanitizer.ts`）+ `session.ts` 注册一行 + 看门狗状态。零渲染层、零私有层 import。
2. **可从 `main` 干净 cut**：`src/main/agent/` 是上游共有路径（AGENTS.md §4 的 graph 工作也在 main 侧），不依赖 `mine` 的任何东西；不需要「先在 mine 开发再重切」。
3. **上游价值天然**：畸形 tool call 毒化会话是 `@earendil-works/pi-*` 生态的通用缺陷，不是本 fork 的私有需求；004 文档的时间线/证据可直接进 PR description。
4. **不碰 AGENTS.md §3 红线**：不动 `src/main/data-dir.ts`、不动 migrations、不需要改 `~/.imboss` 数据根。
5. **可双投**：Fix A（app 侧清洗）可先落在本仓库 `feat/*`；Fix B（400 重试）是上游 `pi-ai` 的 PR。两者独立可合，Fix A 先行即可止血。

---

## 6. 验收标准

### 6.1 单元级（必须）

1. 给定合成 payload：assistant 消息带 `tool_calls:[{id:"a",function:{name:"bash",arguments:"{}"}},{id:"b",function:{name:"",arguments:"{}"}}]` + 两条 `role:"tool"`（`tool_call_id` 分别 `a`/`b`）→ 清洗结果：只剩 `a` 与第一条 tool 消息；返回新对象；原 params 不变。
2. 幂等：对 (1) 的输出再跑一次 → 返回 `undefined`（无改动）。
3. 注册表过滤：`name:"nonexistent_tool"` 在 `params.tools` 非空时被丢；`params.tools` 为空/缺失时**不**触发该规则。
4. 边界：`tool_calls` 全被清洗且 `content` 为空的 assistant 消息被整条丢弃；`content` 非空时保留消息、仅去 `tool_calls`。
5. 看门狗状态机：连续 2 次「error + usage 0 + <2s + 特征串」→ `poisoned`；中间插 1 次成功回合 → 清零；只有 1 次失败 → 不标记。

### 6.2 集成级（必须，用假 provider 复现）

app 支持自定义 provider（取证：`src/main/agent/providers.ts:65-72`，`kind:"custom"` 带 `baseUrl`；models/auth 分别落 `models.json`/`auth.json`），因此可本地起一个 OpenAI 兼容 stub 做确定性复现：

1. stub 第一轮响应：返回一个 `function.name` 为空的 tool call（复刻 L124 的形状，含 `call_` 前缀 id）。
2. 无修复：第二轮请求体里仍含该 tool call → 断言 app 侧记录到 `400` 等价失败（或直接断言 stub 收到畸形 `tool_calls`）。
3. 有修复（Fix A）：断言 stub 收到的第二轮请求体**不含**空名 tool call 及其孤立 tool 结果；且会话继续产出（`stopReason != "error"`）。
4. Fix B：stub 第一轮返回真 400（`{"error":{"message":"tool_calls.function.name is required","type":"invalid_request_error"}}`）→ 断言 app/stub 观测到恰好 1 次重试且重试体已清洗；再返回 400 → 断言不再重试（上限生效）。
5. 回归：对真实事故文件做回放——把 `4.jsonl` 的历史喂给清洗函数，断言输出中**零**空名 tool call、零孤立 tool 结果（这条同时验证 §4.5 的自愈结论）。

### 6.3 可观测性验收

- 每次真实清洗产生 1 条 `tool_call_sanitized` 日志，含 dropped id/原因与前后 message 数；payload 无改动时**不**产生日志（防刷屏）。
- Fix B 重试产生 `tool_calls_400_sanitize_retry`，带 attempt/outcome。
- 看门狗触发产生 `session_poison_detected`，含 `employeeId/chatId/sessionFile/errorTurns/signature`。

### 6.4 非目标（明确不做，避免 PR 范围膨胀）

- 不重写/不编辑任何已存在的会话 jsonl。
- 不给 `pi-agent-core` 的 `prepareToolCall` 打补丁（那是 SDK 行为，交由上游）。
- 不做自动归档/重启会话等 app 层写操作（orchestrator 决策项）。
- 首版不覆盖 `openai-completions` 以外的 provider 适配器。

---

## 7. 风险与待验清单

| # | 项 | 状态 |
| --- | --- | --- |
| 1 | `params.tools` 是否包含本 app 全部可调工具（builtin/MCP/`imb_*`，含 deferred 暴露）——决定 `unregistered` 规则能否默认开启 | **待验**（建议灰度：先只开 `empty_name`） |
| 2 | 空 content + 无 tool_calls 的历史 assistant 消息（L127/L130/L133 型）在 StepFun/magpie 是否可接受 | **待验**（若否，Fix A 追加丢弃规则，见 §4.5） |
| 3 | `pi-ai@1.2.0` 的 `dist/utils/provider-retry.js` 是否与 1.0.4 逐字节相同 | **待验**（本次未单独 diff；不影响结论，因 1.0.4 已确认不含 400 重试） |
| 4 | `before_provider_request` handler 抛错时的行为 | **已确认（只读取证）**：`runner.js:1076-1090` 的 try/catch 会 `emitError` 然后继续链，`currentPayload` 保持上一个值——即 handler 抛异常 = 本次清洗静默跳过、原 payload 放行。对策：handler 内部 try/catch，失败时返回 `undefined` 放行原 payload 并打 error 日志，绝不让清洗失败变成新故障点 |
| 5 | `tool_choice` 与被清洗工具的关系：若 `tool_choice` 指名了某个被清洗掉的名字，是否需要同步调整 | **待验** |
| 6 | 灰度顺序：Fix A → 观察 @4 会话是否自愈 → 再上 Fix B / 看门狗 L2 | 建议 |

---

## 8. 附：取证命令（只读，可复跑）

```bash
# 事故行号（本文件 §1.2 的来源）
python3 - <<'PY'
import json
for i,l in enumerate(open('/home/ilio/.imboss/agent/sessions/chats/11/4.jsonl'),1):
    d=json.loads(l); m=d.get('message',{})
    if m.get('role')=='assistant' and (m.get('stopReason')=='error' or any(c.get('type')=='toolCall' for c in m.get('content',[]))):
        print(i, d['timestamp'], m.get('stopReason'), [(c.get('name'),c.get('id')) for c in m.get('content',[]) if c.get('type')=='toolCall'])
PY

# SDK 版本差异（§3）
diff <(cat node_modules/.pnpm/@earendil-works+pi-agent-core@1.0.4_*/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js) \
     <(cat node_modules/.pnpm/@earendil-works+pi-agent-core@1.2.0_*/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js)

# 重试策略（§4.1）
grep -n "isRetryableProviderError" -A 14 node_modules/.pnpm/@earendil-works+pi-ai@1.0.4_*/node_modules/@earendil-works/pi-ai/dist/utils/provider-retry.js
```

---

*本文档为规格，不含实现代码；实现分支与提交策略由 @0 决定。*
