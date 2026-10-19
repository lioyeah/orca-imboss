# Incident: employee 4 (UI 修复负责人) session silence ~20h — poisoned by malformed tool call

- Date of incident: 2026-10-18 12:03 CST → 2026-10-19 07:5x CST (still unresolved)
- Investigator: employee 6 (运维工程师), read-only diagnosis
- Scope: chat 11, employee 4 session `/home/ilio/.imboss/agent/sessions/chats/11/4.jsonl`

## 1. Root cause (evidence-supported, not hypothesis)

The session is **poisoned by a single malformed tool call** and can no longer complete any model turn.

At `2026-10-18T04:03:23.096Z` (12:03:23 CST) the model (`group/auto-step-5-preview` via provider `magpie`, api `openai-completions`) emitted an assistant message containing **two** tool calls; the second one had an **empty `name`** and empty arguments:

- `4.jsonl:123` — `toolCall name='' id='call_18df83e6959c779000000001' args={}`

The runtime (Pi SDK, `@earendil-works/pi-agent-core@1.0.4`) could not resolve it and wrote back an error tool result:

- `4.jsonl:125` — `toolResult toolName='' isError=true text="Tool  not found"` (produced by `dist/agent-loop.js:483-489`, `prepareToolCall`: `createErrorToolResult(\`Tool ${toolCall.name} not found\`)`)

Critically, the **assistant message holding the empty-name tool call stayed in the session history** and there is **no sanitization and no retry** anywhere:

- app side: `src/main/agent/model-runtime.ts` has no 400 / `invalid_request_error` handling
- SDK side: no `sanitize`/`repair` path in `pi-agent-core@1.0.4` (`dist/agent-loop.js`)

So the very next provider request replays the history containing `tool_calls: [{function: {name: ""}}]` and StepFun (China) rejects it:

- `4.jsonl:126` — `400: {"code":null,"message":"StepFun (China): tool_calls.function.name is required","param":null,"type":"invalid_request_error"}`, `stopReason: "error"`, usage all zeros, 1.24 s after the previous message

Every later wake reproduces the identical failure:

- `4.jsonl:129` — `2026-10-18T09:21:43.806Z` (17:21:43 CST, reply to ping id 107), 1.76 s
- `4.jsonl:132` — `2026-10-18T23:36:34.846Z` (07:36:34 CST, reply to notify id 115), 1.37 s

File mtime `2026-10-19 07:36:34.845 +0800` equals that last failed turn → the file keeps being written (notification delivery + wake + failed request) while producing zero output.

## 2. Failure point

Chain: 通知送达 → 会话被唤醒 → **模型回合执行** → (断裂) → 工具调用 → 输出回写

- Notification delivery: **OK**. Wakes are recorded (`4.jsonl:127-128` = system+user pair for id 107, `4.jsonl:130-131` for id 115) and the session file is written at the notify timestamp.
- Session wake: **OK**.
- Model turn: **BROKEN at the provider request-validation stage** — the request never gets past schema validation (0 tokens billed, ~1.4 s), because the persisted history contains a tool call with an empty `function.name`.
- Tool execution / output write-back: never reached.

Precise location: between "assistant message persisted" and "provider request built" — the runtime persists malformed tool calls verbatim and sends them back verbatim.

## 3. Timeline

| Time (CST) | Event |
| --- | --- |
| 10-18 12:00:21 | @4's last real work: commit `3fd8786` (issue 001 verification) |
| 10-18 12:03:23 | Poisoning turn: empty-name tool call + "Tool  not found" |
| 10-18 12:03:24 | First 400 — turn dies |
| 10-18 12:03:45 | @0 dispatches #002/#003/#004 (chat 11 id 97, notify @4) — **22 s too late, never seen by @4** (no wake pair recorded for it) |
| 10-18 17:21:41 | Ping id 107 → wake → 400 in 1.76 s |
| 10-19 07:36:33 | Notify id 115 → wake → 400 in 1.37 s (this is the file's last mtime) |

## 4. Impact surface

- **Individual failure, not infrastructure failure.** Fleet-wide scan of every `/home/ilio/.imboss/agent/sessions/chats/*/*.jsonl`: exactly **one** empty-name tool call in the whole fleet (this one). Error turns per session: `1.jsonl` 0, `2.jsonl` 0, `3.jsonl` 0, `4.jsonl` 3, `5.jsonl` 0, `6.jsonl` 0.
- System layer clean: no zombies, no OOM/segfault evidence available (`dmesg` is permission-denied for this user: `dmesg: 读取内核缓冲区失败: 不允许的操作`), RAM 27 GB with 18 GB available, swap 2 GB used, disk 11% / 10%, load 1.65. Live app process never restarted (PID 261970, elapsed 21 h, same mount `/tmp/.mount_imbosspWR5iY`), so no mtime断层 explanation.
- **Latent risk for everyone**: all 6 employees run the same model+provider (`group/auto-step-5-preview` / `magpie`). A near-miss is already on record — `4.jsonl:104` shows `imb_read_chat` called with missing `chatId` (validation error, recovered because the call itself was well-formed). Any single malformed tool call permanently bricks a session with no auto-recovery.
- Blast radius of the silence itself: #002/#003/#004 dispatch never reached @4; queue was re-routed to @5/@1 (already handled by the assistant).

## 5. Recommendations and risk

1. **Immediate (owner: orchestrator, not SRE)** — @4's session cannot self-heal. Two options:
   - (a) *Recommended*: archive `4.jsonl` and let employee 4 start a fresh session (needs an app-level action; the poisoned turn is unreachable in-place).
   - (b) Surgical file edit removing `4.jsonl:123`'s second toolCall and `4.jsonl:125`'s orphan toolResult. **Risk**: `parentId`/message-id chain, and any live in-memory copy in the running app would diverge from disk. Not live-safe; do not do it while the app is running.
2. **Structural fix (upstream of this fork, worth a PR candidate)** — never send an invalid tool call:
   - at request-build time, drop assistant `tool_calls` whose `name` is empty or not in the registered tool set, and drop the orphan tool results they produced;
   - on `400 invalid_request_error` mentioning `tool_calls`, sanitize and retry once before failing the turn.
   Location: app `src/main/agent/*` request assembly, or upgrade `@earendil-works/pi-agent-core` — note `1.2.0` is already present in `node_modules/.pnpm` while the app resolves `1.0.4`; evaluate whether 1.2.0 fixes it (dependency change → boss decision, and it must be re-validated with `pnpm run typecheck` + `pnpm run build`).
3. **Watchdog** — flag a session as poisoned when ≥2 consecutive turns end with `stopReason: "error"`, zero usage, and <2 s latency; surface it in the assistant's health view so a 20 h silence can never happen silently again. Signature to match: `tool_calls.function.name is required`.
4. **Process note** — a dispatch that lands within seconds of a session's death is lost with no queued fallback (id 97, 22 s after the poisoning). Re-pinging after a failed turn is already the effective recovery path; consider one automatic re-ping on turn error.

## 6. Read-only compliance

No process killed or restarted; no writes to the live instance, `~/.imboss`, `~/.config/orca-imboss`, or `/tmp/.mount_imbosspWR5iY`; no repo writes other than this document (committed with `git add -N` + `git commit --only`); the boss's 21 staged WIP files untouched (`git diff --cached --name-only | wc -l` = 21 before and after). Live instance verified healthy throughout: PID 261970 unchanged, `~/.imboss` mtime still `2026-10-18 10:46:48`.

## 7. 行号勘误(据 `005-toolcall-sanitize-pr-spec.md` 复验,2026-10-19)

原文 §1/§2 的行号有一处系统性 +1 偏移(当时按 `grep -n` 的视觉行号记录,未按 JSONL 逐行解析核对)。**事实与结论不变,仅行号修正**;后续引用请以本节与 005 文档 §1.2 为准。

| 原文行号 | 准确行号 | 内容 |
| --- | --- | --- |
| `4.jsonl:123` | **`4.jsonl:124`** | 毒化 assistant 消息(`stopReason: toolUse`,`2026-10-18T04:03:23.096Z`),`message.content[]` 内含两个 `{type:"toolCall"}` 条目:第一个 `name="bash"` `id="chatcmpl-tool-9514387ab685a2b2"`(正常),第二个 `name=""` `id="call_18df83e6959c779000000001"` `arguments={}`(**空名,id 前缀 `call_` 而非 `chatcmpl-tool-`,即结构畸形的 provider 输出**) |
| `4.jsonl:125` | **`4.jsonl:126`** | 孤立 error toolResult:`role: toolResult` `toolCallId="call_18df83e6959c779000000001"` `toolName=""` `text="Tool  not found"` `isError=true`,`2026-10-18T04:03:23.131Z` |
| `4.jsonl:126` | **`4.jsonl:127`** | 第一次 400:`stopReason: "error"`,`2026-10-18T04:03:24.346Z`,errorMessage `400: {"code":null,"message":"StepFun (China): tool_calls.function.name is required","param":null,"type":"invalid_request_error"}`,usage 全 0 |
| `4.jsonl:129` | **`4.jsonl:130`** | 第二次 400:`2026-10-18T09:21:43.806Z`(回复 ping id 107,1.76 s) |
| `4.jsonl:132` | **`4.jsonl:133`** | 第三次 400:`2026-10-18T23:36:34.846Z`(回复 notify id 115,1.37 s)= 文件最后 mtime |
| `4.jsonl:127-128`(wake pair) | **`4.jsonl:128-129`** | id 107 的 system+user 唤醒对 |
| `4.jsonl:130-131`(wake pair) | **`4.jsonl:131-132`** | id 115 的 system+user 唤醒对 |

补充取证口径(与 005 一致):toolCall 在 `4.jsonl` 里位于 `message.content[]` 的 `{type:"toolCall", id, name, arguments}` 条目中,**不是**顶层 `toolCalls` 字段——写巡检脚本时按这个结构走,否则会漏报(本次巡检脚本第一版即因此漏报,已修正)。
