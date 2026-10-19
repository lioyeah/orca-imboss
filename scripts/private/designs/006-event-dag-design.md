# 006 — 事件因果 DAG 设计(可追溯性/自愈性的地基)

- 作者:employee 6(运维工程师 / SRE),只读诊断 + 单文件设计文档
- 日期:2026-10-19
- 触发:老板 m00617「我希望图能成为鲁棒性、自愈性和可追溯性的基础设施,而不是只拿来浏览」;@0 派单(chat 11 id 185)
- 上游依据:chat 10 id 152(架构结论:会话树当执行事实源 + 上叠薄事件因果 DAG + 网只做路由)
- 关联文档:`scripts/private/ops/004-employee4-session-poison.md`(毒化根因,含 §7 行号勘误)、`scripts/private/ops/005-toolcall-sanitize-pr-spec.md`(Fix A/B 规格,commit 581db77)
- 红线:本文只做设计,不写 `src/`;实现由后续派单决定。**不复活 `src/main/graph/` 那 765 行**(`3e5fcee` 已拆),renderer 现有图谱 UI 不许破坏。

---

## 0. TL;DR

现状的图(`src/main/db/graph.ts` 的 `buildGraph()`)只有「聊天/员工/附件/工具」五种实体节点,边只有 9 种实体间关系(`src/shared/types/graph.ts:26-36`),且**不落库、按需派生**;派工→唤醒→回合→工具调用→错误这条链在里面没有边,所以「@4 的派工 id 97 死在哪一步」图答不上,定位 100% 靠会话 jsonl 人工取证(004 全文即此代价)。

本设计:**不动实体图,在它下面新增一层「事件因果 DAG」**——事件为一等公民节点、因果为一等公民边、**指针不拷贝**(事件只存 `messages.id` 与会话 jsonl 的 `路径+行号`,不复制任何内容)。两层分工:

| 层 | 回答什么 | 现状 | 本设计 |
| --- | --- | --- | --- |
| 会话树(jsonl) | 执行事实源,每回合必落盘 | 已有,append-only | **不变**,继续当唯一事实源 |
| 事件因果 DAG | 什么发生了、为什么、谁导致谁 | **缺失** | 新增:2 张表 + 1 个 writer + 查询 API + backfill |
| 实体图(`buildGraph`) | 存在哪些聊天/员工/产物 | 已有,派生 | **不变**,renderer 继续消费 |
| 网(collaborators_topology) | 该派谁(路由) | 已随 WIP 移除 | **不在本设计范围**,明确非目标 |

验收演示(§7.3):把 @4 毒化案在新图上重放——「派工 id 97 死在哪一步」= **从未送达**(派工事件存在、但没有 `dispatch→wake` 边);ping id 107 = `dispatch→wake→turn→tool_call(name="")→error(400)` 一次遍历即答。

---

## 1. 事件词汇表(最小集)

每条事件 = 一个**已发生的事实**,带 `kind / ts / chat_id / employee_id / status` 和一组指针字段(§3)。v1 取 9 个 kind,覆盖今天团队全部分工与事故形态:

| kind | 语义 | 触发点(自动/手动) | 指针字段 | 关键 meta(标量,有界) |
| --- | --- | --- | --- | --- |
| `dispatch` | 派工:一条带 `notify` 的消息把活派给员工 | 自动 | `msg_id` | `notify_ids`(数组,≤16),`group_chat_id` |
| `wake` | 唤醒:通知送达并唤醒目标会话 | 自动 | `msg_id` + `session_ref/line` | `reason`(`notify`/`steer`/`cron`/`ask_answer`),`delivered`(bool) |
| `turn` | 模型回合结束(成功或失败) | 自动 | `session_ref/line` | `model`,`provider`,`api`,`usage.{input,output,total}`,`stop_reason`,`latency_ms` |
| `tool_call` | 一次工具调用结束 | 自动 | `session_ref/line` | `tool_name`,`is_error`,`tool_call_id` |
| `error` | 一次失败(provider 400 / 工具 not found / 回合 error) | 自动 | `session_ref/line` + 所属 `turn` 事件 | `signature`,`status_code`,`latency_ms` |
| `message` | 聊天消息落库(report/ask/answer/progress/text/ack) | 自动(observer) | `msg_id` | `kind`,`sender_employee_id` |
| `commit` | 一次 git 提交 | **手动/CLI/backfill** | `commit_sha` | `files`(≤32 路径),`insertions`,`deletions` |
| `verify` | 一次复测结论(过/不过 + 证据) | 手动/CLI | `msg_id`(复测报告)+ `commit_sha`(被测) | `result`(`pass`/`fail`),`evidence`(≤8 路径) |
| `issue_state` | issue 状态迁移(open→verified→fixing→fixed-verified→closed) | 手动/CLI | `msg_id` 或 issue 文档路径 | `from`,`to`,`issue` |

**明确不进的**:消息内容、工具参数、模型思考文本——只存 id 与有界标量(§12.4 隐私约束)。`ping` 不单列,它是 `reason="notify"` 的 `wake`;`build`(typecheck/build 绿)并入 `verify` 的 `result` 维度,v1 不单列。

---

## 2. 边语义:什么是一等公民

**方向约定(先定死,避免实现期各写各的):边从「因」指向「果」**,即 `dispatch → wake → turn → tool_call → error`,阅读方向 = 时间/因果流向。

| kind | 方向 | 含义 | 一等公民? |
| --- | --- | --- | --- |
| `caused_by` | 果 → 因 | 直接因果(默认边;一条事件通常只有一条) | 是 |
| `part_of` | 部分 → 整体 | `tool_call`/`error` 隶属于某次 `turn`;`turn` 隶属于某次 `wake` | 是 |
| `verified_by` | 被验 → 证据 | `dispatch`/`commit` 被某次 `verify` 结论覆盖 | 是 |
| `replies_to` | 复 → 原 | 员工的 report/answer 消息回复某条 dispatch 或 wake | 是 |
| `supersedes` | 新 → 旧 | 重新派工取代上一次派工(同一 issue 二次派单) | 是(可后补) |

非一等公民(不建边,用列表达):`chat_id`/`employee_id`(归属)、`msg_id`/`session_ref`(指针)、`commit_sha`(产物)。**「没有边」本身就是结论**——派工 id 97 的答案就是「不存在 `dispatch→wake` 边」,这是本设计相对 004 人工比对的核心增益。

---

## 3. 存储:新表,指针不拷贝

### 3.1 表结构(新增 2 张表,迁移 index 6 → `user_version = 7`)

`src/main/db/migrations.ts` 现有 `MIGRATIONS[0..5]`(`migrate()` 按 `user_version` 顺序应用,`db.pragma("user_version = index + 1")`),故新增条目为 index 6:

```sql
-- 6 — event causal DAG (append-only; pointers, never copies)
CREATE TABLE IF NOT EXISTS dag_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT    NOT NULL,              -- §1 词汇表
  ts           INTEGER NOT NULL,              -- epoch ms
  chat_id      INTEGER REFERENCES chats(id)     ON DELETE CASCADE,
  employee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status       TEXT    NOT NULL DEFAULT 'ok',  -- ok | error | skipped
  signature    TEXT,                           -- 错误签名,如 tool_calls.function.name is required
  latency_ms   INTEGER,
  msg_id       INTEGER REFERENCES messages(id)  ON DELETE CASCADE,  -- 指针:聊天消息
  session_ref  TEXT,                           -- 指针:chats/<chatId>/<employeeId>.jsonl
  session_line INTEGER,                        -- 指针:1-based 行号
  commit_sha   TEXT,                           -- 指针:git commit
  dedupe_key   TEXT    NOT NULL UNIQUE,        -- 幂等键(§3.3)
  meta         TEXT    NOT NULL DEFAULT '{}'   -- 有界 JSON,仅标量
);
CREATE INDEX IF NOT EXISTS idx_dag_events_chat_ts     ON dag_events(chat_id, ts);
CREATE INDEX IF NOT EXISTS idx_dag_events_employee_ts ON dag_events(employee_id, ts);
CREATE INDEX IF NOT EXISTS idx_dag_events_kind_ts     ON dag_events(kind, ts);
CREATE INDEX IF NOT EXISTS idx_dag_events_signature   ON dag_events(signature) WHERE signature IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dag_events_commit      ON dag_events(commit_sha) WHERE commit_sha IS NOT NULL;

CREATE TABLE IF NOT EXISTS dag_edges (
  source_id INTEGER NOT NULL REFERENCES dag_events(id) ON DELETE CASCADE,  -- 因
  target_id INTEGER NOT NULL REFERENCES dag_events(id) ON DELETE CASCADE,  -- 果
  kind      TEXT    NOT NULL,                                             -- §2 词汇表
  PRIMARY KEY (source_id, target_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_dag_edges_target ON dag_edges(target_id, kind);
```

设计要点:
- **无 FTS、无触发器**:写入路径必须便宜(004/005 的教训:agent 循环路径上的任何额外失败模式都会被放大)。`messages_fts` 那套 trigram + 三触发器只属于 `messages`,新表不碰。
- **ON DELETE CASCADE/SET NULL**:聊天删除时事件随之清理;员工删除不销毁事件(保留审计)。
- **不建 `dag_nodes` 表**:实体(chat/employee/artifact)已在 `chats`/`employees` 表里,复制一份就违反「指针不拷贝」。产物登记册由 `commit_sha` + `verify.meta.evidence` 聚合而出(§5.4)。

### 3.2 指针纪律(硬规则)

1. 事件**永不复制**消息内容、工具参数、diff、模型输出;只存 `msg_id` 或 `session_ref + session_line` 或 `commit_sha`。
2. `meta` 有界:≤ 8 个键、单值 ≤ 256 字符、总量 ≤ 2 KB;writer 超限即截断并记 `meta_truncated: true`。
3. `session_ref` 存相对形式 `chats/<chatId>/<employeeId>.jsonl`,与 `src/main/agent/session-files.ts:20-26` 的 `sessionPathFor()` 一致(绝对路径随数据根变化,不入库)。

### 3.3 幂等键 `dedupe_key`

| kind | dedupe_key 构成 |
| --- | --- |
| `message` | `v1:msg:<msg_id>` |
| `dispatch` | `v1:dispatch:<msg_id>` |
| `wake` | `v1:wake:<chat_id>:<employee_id>:<msg_id|0>:<ts_bucket_ms>` |
| `turn` | `v1:turn:<chat_id>:<employee_id>:<responseId 或 ts>` |
| `tool_call` | `v1:tool:<toolCallId>` |
| `error` | `v1:err:<turn 事件 id 或 session_line>` |
| `commit`/`verify`/`issue_state` | `v1:<kind>:<commit_sha 或 issue>:<序号>` |

backfill 与 live 写入共用同一套键 → 重放两次行数不变(验收 6)。`v1:` 前缀留给未来 schema 演进(§12.5)。

---

## 4. 最小写入挂钩点(文件:行号)

分两级。**Tier 1 全自动、单点订阅、diff 极小**;Tier 2 走 CLI/backfill,不侵入运行路径。

### Tier 1(自动,进程内)

| # | 位置 | 产出事件 | diff 形状 |
| --- | --- | --- | --- |
| H1 | `src/main/agent/session.ts:540-542` 的 `session.subscribe((event) => { this.onEvent?.(event); })` | `turn` / `tool_call` / `error` | 在既有 `onEvent` 转发旁增加一个 DAG writer 调用;SDK 事件面已含所需全部字段(见下) |
| H2 | `src/main/agent/builtin-tools.ts:190-212`(`imb_send_message`:`appendMessage(...)` 之后的 `for (const pid of input.notify ?? [])` 循环里 `await wakeAgent(pid, input.chatId, ..., { mode: "steer" })`) | `dispatch`(循环前)+ `wake`(循环内,每次一条,边 `caused_by → dispatch`) | 一个 writer 调用 + 循环内一个;天然带 `notify` 列表 |
| H3 | `src/main/db/messages.ts:66-100` 的 `onMessageAppended` observer(现成机制,`src/main/integrations/manager.ts:89` 已在用) | `message`(所有 kind) | **零 diff 到插入路径**:启动时 `onMessageAppended(writer)`,与 IM 转发并列注册 |
| H4 | `src/main/agent/session-queue.ts:124` `wakeAgent()`(以及 `:85` `deliver()` 的 steer 落队列分支) | `wake`(cron / ask_answer / 非 notify 路径) | 在 `deliver()` 入口按 `opts.mode` 与调用方打 `reason`;H2 的 notify 路径由此去重(同一 wake 不双写,靠 dedupe_key) |
| H5 | `src/main/cron.ts:97,171`、`src/main/ipc/message.ts:62` 的 `wakeAgent` 调用点 | `wake` 的 `reason` 标注 | 各传一个 reason 常量,或由 H4 统一推断(待验,见 §12.6) |

**H1 的事件面已由 SDK 保证**,无需改 SDK:`@earendil-works/pi-agent-core@1.0.4` 的 `dist/types.d.ts:450-490` 定义 `AgentEvent` = `agent_start` / `agent_end` / `turn_start` / `turn_end { message: AgentMessage; toolResults: ToolResultMessage[] }` / `message_start` / `message_update` / `message_end` / `tool_execution_start {toolCallId, toolName, args}` / `tool_execution_update` / `tool_execution_end {toolCallId, toolName, result, isError}`。`turn_end.message` 携带 `stopReason` / `usage` / `errorMessage` / `responseId` / `model` / `provider`(与 `4.jsonl` 落盘结构一致),足以生成 `turn` + `error`;`tool_execution_end.isError` + `toolName` 足以生成 `tool_call`(空名工具调用在这里显形,正是 004 的 L124/L126)。

**H1 与 Fix A 的关系**:Fix A(@7,`feat/toolcall-sanitize`)在请求组装处清洗毒化,本设计的 H1 只观测不改写;两者无代码冲突,可并行合入。

### Tier 2(CLI / backfill,不侵入运行路径)

| # | 位置 | 产出事件 |
| --- | --- | --- |
| H6 | 新脚本 `scripts/private/ops/dag-record.mjs`(或等价 CLI) | `commit` / `verify` / `issue_state`,由人或 steward 流程显式调用 |
| H7 | 新脚本 `scripts/private/ops/dag-backfill.mjs`(只读 jsonl + messages 表,只写 dag 表) | 全量回填(§7) |

不引入 git post-commit hook 自动写应用 DB:跨进程、跨 HOME、失败静默,违背「写入可观测」;提交事件由 H6 显式记录(见 §11.5)。

---

## 5. 查询 API:必须能回答什么,明确不回答什么

新模块 `src/main/db/dag.ts`(纯函数 + 预编译语句),经 `src/main/ipc/dag.ts` + `src/preload/index.ts` 暴露(与既有 `src/main/ipc/graph.ts:6` 的 `graph:get` 并列,**不改 `graph:get`**)。

| API | 语义 | 实现要点 |
| --- | --- | --- |
| `dagTimeline(chatId, fromTs?, toTs?)` | 某聊天的全事件时间线 | `idx_dag_events_chat_ts` 范围扫描 |
| `dagBlame(eventId)` | **向后**因果闭包:这件事为什么发生/死在哪 | 递归 CTE 沿 `dag_edges.target_id` 上溯,深度 ≤ 8、节点 ≤ 512 |
| `dagForward(eventId)` | **向前**影响闭包:这次派工导致了什么 | 沿 `source_id` 下溯 |
| `dagTrace(chatId, employeeId?)` | 一次任务的端到端链(派工→唤醒→回合→工具→错误→复测) | 时间线 + 边装配,单次遍历 |
| `dagHealth(chatId, employeeId)` | 毒化检测状态机(§6) | 连续 error-turn 判定 + 签名匹配 |
| `dagLineage(issue 或 chatId)` | 任务血缘:派工 → commit → verify → issue_state | `verified_by` + `supersedes` 遍历 |
| `dagArtifacts(chatId?)` | 产物登记册:commit_sha + 证据路径 + 产出员工 | 聚合 `commit_sha`/`verify.meta.evidence`,**不复制文件内容** |

**能回答(验收即以此为准)**:
1. 「派工 id 97 死在哪一步」——一次 `dagBlame`/`dagTrace` 给出:派工存在、无 `wake` 边 ⇒ 从未送达(004 里靠人工比对 6 个 jsonl 才得出的结论)。
2. 「@4 为什么 20 小时零产出」——`dagTrace` 给出 `dispatch(未送达)` + `wake(id 107) → turn → tool_call(name="") → error(400 tool_calls.function.name is required) → turn → error → turn → error`。
3. 「这个 commit 验证过没有、由谁验的」——`dagLineage`。
4. 「现在有没有会话正在中毒」——`dagHealth` 全队扫描。
5. 「这批产物分别是哪次派工产生的」——`dagArtifacts`。

**明确不回答**(写进代码注释与文档,防范围蠕变):
- **路由/派单推荐**(该派谁)——那是「网」的职责,已随 WIP 移除,不复活。
- 消息全文检索——`messages_fts` 已有,不重复造。
- 实时会话状态(是否 streaming、队列深度)——`session-queue.ts` 内存态才是事实源,DAG 只记已发生。
- 跨 HOME/跨机器的全局视图——DAG 绑定单个数据根(与 `getDataRoot()`/AGENTS.md §3 数据隔离一致)。

---

## 6. 自愈回路:检测、标记、恢复,以及与 Fix A/看门狗的边界

**DAG 是观测与记录层,不是执行层。** 回路里三个角色的归属:

| 角色 | 做什么 | 归属 | 依赖 |
| --- | --- | --- | --- |
| **Fix A** | 请求组装处清洗空名/未注册 tool_calls + 孤立 tool result,毒化历史下次请求即清 | @7,`feat/toolcall-sanitize`,规格 005 | 无(可独立 PR) |
| **看门狗** | 轮询/事件驱动检测:连续 ≥2 回合 `stopReason="error"` + usage 全 0 + <2s + 签名 `tool_calls.function.name is required`;升级告警 | 后续派单(未开工) | 数据源:优先 `dagHealth`,**同时保留 jsonl 直读兜底**,不被本设计阻塞 |
| **恢复执行器** | 自动 re-ping(`session-queue.ts:wakeAgent`)/ 归档开会话 / 通知 orchestrator | orchestrator 决策后执行 | **必须晚于 Fix A**,否则 re-ping 只是再触发一次 400 |

状态机(每个 `(employee, chat)` 一条,由 `dagHealth` 输出):

```
healthy ──(1 个 error-turn)──► suspect ──(第 2 个连续 error-turn + 签名)──► poisoned
   ▲                              │                                          │
   │                              └──(成功回合)──► healthy                     │
   └──────────────────────(Fix A 上线后首次成功回合)──► recovering ──► healthy
```

- `suspect` 只记录不动作(单次 400 可能是 provider 抖动)。
- `poisoned` 的动作序列:**L1 告警**(事件 + 通知 orchestrator)→ **L2 自动 re-ping**(仅当 Fix A 已确认在线)→ **L3 归档 + 新会话**(orchestrator 执行,SRE 只给建议——004 已定:app 运行中手工改会话文件不安全)。
- 004 的教训「派工 22 秒后到达即丢失」由 `dispatch` 无 `wake` 边这一**可查询事实**承接:看门狗可增补一条规则「`dispatch` 事件在 N 秒内无 `wake` 边且无 `replies_to` ⇒ 补发」。

---

## 7. Backfill 方案 + @4 重放验收

### 7.1 数据源(全部只读)

1. 会话 jsonl:`/home/ilio/.imboss/agent/sessions/chats/<chatId>/<employeeId>.jsonl`(路径规则见 `src/main/agent/session-files.ts:20-26`);逐行 JSON 解析,**toolCall 在 `message.content[]` 的 `{type:"toolCall", id, name, arguments}` 条目里,不是顶层 `toolCalls` 字段**(004 §7 已记此坑,backfill 按此实现)。
2. 应用 DB:`messages` 表(拿 `msg_id`/`kind`/`created_at`)、`chats`、`employees`、`sessions`。
3. 既有文档中已记录的 commit sha(004/005/各 issue 报告)——由 H6 显式补录,不从文本里正则猜。

### 7.2 回填顺序

`issue_state`(文档既有状态)→ `commit`(报告引用的 sha)→ `message`(DB,权威)→ `dispatch`(带 notify 的消息)→ `wake`(jsonl 里的 system+user 唤醒对)→ `turn`/`tool_call`/`error`(jsonl 回合级)→ 装配边。任何一步失败只记录不中断(幂等键保证可重跑)。

### 7.3 验收演示:把 @4 毒化案重放出来

回填 chat 11 后,以下四条必须**一次遍历即答**(每条都是可证伪判据):

| # | 查询 | 期望结果 |
| --- | --- | --- |
| D1 | `dagBlame(<id 97 的 dispatch 事件>)` + `dagForward` | 派工在,`dispatch→wake` 边**不存在**;时间上 22s 后出现 `error` ⇒ 死因 = 从未送达 |
| D2 | `dagTrace(11, employeeId=4)` | `wake(id 107) → turn → tool_call(name="") → error(400) → turn → error → turn → error`,与 `4.jsonl` L128-133 一一对应 |
| D3 | `dagHealth(11, 4)` | `poisoned`,`signature = tool_calls.function.name is required`,连续 error-turn = 3 |
| D4 | `dagHealth(11, 1/3/5)` | `healthy`(巡检结论的图形化复现,见 §10.8) |

行号级指针可核对:每个 `turn`/`error` 事件的 `session_ref+session_line` 必须落在 `4.jsonl` 的 L127/L130/L133(400 回合)、L124(毒化 assistant 消息)、L126(孤立 error toolResult)。

---

## 8. 上游 PR 策略

按 AGENTS.md §1 分支模型:`feat/*` 从 `main` 切出,只上 PR,**零 `src/renderer/private/` 依赖**。

| 部分 | 上游价值 | 建议 |
| --- | --- | --- |
| `dag_events`/`dag_edges` schema + 迁移 | 通用可观测性地基,与私有分支无关 | **可 PR**(第三个上游 PR 候选,前两个:#002 只动上游文件零私有依赖;Fix A tool_calls 清洗) |
| `src/main/db/dag.ts` writer + 查询 API | 通用:任何 agent 运行时都能记事件因果 | **可 PR** |
| H1/H3/H4 挂钩点 | 通用:复用既有 `session.subscribe` / `onMessageAppended`,零新机制 | **可 PR** |
| H6/H7 CLI + 词汇表里团队专属部分(`issue_state` 状态机、`dispatch` 的 notify 语义) | 与 Orca 的 issue 流程耦合 | 私有层或配置化映射,**不进 PR** |
| 本设计文档(`scripts/private/designs/006-*.md`) | — | 留在 `mine`(私有路径天然进不了上游) |

门禁由 @2 的 `scripts/private/PR-READY.md` 把关(re-cut 测试、diff 卫生、提交结构、证据要求),本文不重复。

---

## 9. 非目标

1. **不复活 `src/main/graph/` 那 765 行**(artifact-registry/causal-context/collaborator-topology,`3e5fcee` 已拆);从零长轻的。
2. **不改 `buildGraph()` 与 `graph:get` 的现有语义**;renderer 图谱模块(`src/renderer/components/modules/graph/graph-module/index.tsx:48`)继续原样消费,DAG 是后端地基,UI 消费是后话。
3. **不重新注册 agent 工具**(`graph_context`/`collaborators_topology` 是老板 WIP 主动移除的;是否以新形态回来是产品决策,见 §11.2)。
4. **不取代会话树**作为执行事实源;DAG 全部是指针,删了 DAG 表不影响 agent 运行(可观测性降级,功能性无损)。
5. **不做路由/派单推荐**(网的职责)。
6. **不复制任何内容**:无消息正文、无工具参数、无 diff、无模型输出入库。
7. **不改 Fix A / 看门狗的实现**(分属 @7 与后续派单);本文只定义数据与查询契约。

---

## 10. 可证伪的验收标准

1. **迁移**:全新 DB `PRAGMA user_version` = 7;既有 DB(user_version 6)迁移后 = 7;**连续跑两次 `migrate()` 无报错、无重复行**(`CREATE TABLE IF NOT EXISTS` + `dedupe_key` 唯一约束兜底)。
2. **指针不拷贝**:对任意 `msg_id` 非空的事件行,`SELECT content FROM messages WHERE id = ?` 是唯一副本;`dag_events` 中不存在长度 > 256 的 `meta` 值;`session_ref+session_line` 解析出的行,其 `timestamp` 与事件 `ts` 相差 ≤ 1000ms。
3. **重放 demo**:§7.3 的 D1–D4 全部成立,且每条查询 ≤ 1 次递归 CTE(单条 SQL)。
4. **写入路径安全**:注册 DAG writer 后跑完一个完整 agent 回合,回合输出与未注册时逐字节一致;注入一个必然抛错的 writer,回合不失败、只打 error 日志(复用 005 §7 已确认的「handler 异常被吞」教训:writter 自己 try/catch,绝不让异常逃逸进 agent 循环)。
5. **写入成本**:10 万事件量级下,事件写入 p99 < 5ms;新表无 FTS、无触发器(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name LIKE 'dag%'` = 0 行)。
6. **幂等**:同一份 jsonl + messages 回填两次,`SELECT count(*) FROM dag_events` 与 `dag_edges` 完全不变。
7. **renderer 零回归**:同一种子 DB 在加 DAG 表前后,`graph:get` 返回的 `nodes`/`edges` 数量与 id 集合一致。
8. **健康查询**:回填数据上 `dagHealth(11,4)` = poisoned(签名 `tool_calls.function.name is required`),`dagHealth(11,{1,3,5})` = healthy;与 §10.9 的独立巡检脚本结论一致。
9. **上游卫生**:`git grep -c "src/renderer/private" -- src/main/db/dag.ts src/main/db/migrations.ts src/main/ipc/dag.ts` = 0(可从 `main` 干净 cut)。
10. **独立巡检脚本**(本文附带产物,只读):对 `chats/11/{1,2,3,4,5,6}.jsonl` 逐行解析,输出「空名 toolCall / error 回合 / usage-0 回合 / 末行完整」四列;期望仅 `4.jsonl` 命中(2026-10-19 08:12 实测已成立,见表)。

---

## 11. 需要老板拍板的点(不自行决定,不阻塞其他节)

| # | 事项 | 影响面 | 我的建议 |
| --- | --- | --- | --- |
| 11.1 | 新增 2 张表 + 迁移 6→7 | 每个构建、每个 HOME 的 DB;`AGENTS.md §3` 数据隔离纪律不变(迁移只进不退) | 采纳:只增表、不改既有表,回滚 = 删表(数据可弃,因为全是可再生指针) |
| 11.2 | 是否重新注册 agent 侧查询工具(如 `imb_dag_trace`) | 老板 WIP 主动移除了图工具;这是产品决策 | v1 **不注册**;先只做 main 进程 API + IPC,验证有用再加 |
| 11.3 | DAG 查询是否对 renderer 开 IPC(`dag:*` 通道) | 新增 preload 暴露面 | v1 开**只读**两个(`dag:timeline`/`dag:trace`),其余 main 进程内 |
| 11.4 | 保留策略(事件只增不减?) | DB 体积:估每行 ≤ 512 B,100 万事件 ≈ 300–500 MB | 默认永久保留(审计价值);若设上限,建议「90 天热 + 可归档」而非静默删除,需单独拍板 |
| 11.5 | `commit`/`verify`/`issue_state` 是否要自动采集 | 自动 = git hook 跨进程写 DB(失败静默、跨 HOME 易错) | v1 只走 H6 CLI + backfill;不做 hook |
| 11.6 | 看门狗的数据源 | 若绑死 DAG,看门狗会被本设计阻塞 | 看门狗优先读 `dagHealth`,**保留 jsonl 直读兜底**,两者可独立上线 |

---

## 12. 风险与待验

1. **jsonl 行号稳定性**(中):`session_line` 指针假设文件只追加。若未来出现压缩/重写,指针失效。缓解:事件同时存 `ts`,读取时校验时间戳,不符则标记 `pointer_stale` 而非给出错误因果。**待验**:app 是否存在任何重写会话文件的路径(当前只见到 append)。
2. **会话文件不在 DB 级联范围内**(中):`session_ref` 指向 `~/.imboss/agent/sessions/...`,聊天删除只级联 DB 行。**待验**:`session-queue.ts:190` `disposeForChat()` 是否删除 jsonl;若不删,DAG 需容忍「指针文件已不存在」并降级为「仅 msg_id 可解析」。
3. **写入放大**(低-中):H1 在每条 SDK 事件上触发,一次回合可能十余条。缓解:单条预编译 INSERT + 异步队列(不阻塞回合结算,复用 005 的「fire-and-forget + 自容错」模式);按 §10.5 的量测验收。
4. **隐私/体积**(已约束):`meta` 只放标量、禁工具参数与消息正文;超限截断并打标记。
5. **dedupe_key 演进**(低):`v1:` 前缀 + UNIQUE 约束;未来若事件形状变化,升 `v2:` 而非改键语义(否则重放会静默丢事件)。
6. **wake 的 reason 归属**(待验):H2(notify/steer)、H4(cron/queue)、H5(ask_answer)三条路径都要打 `reason` 且不双写;实现时需确认 `deliver()` 能否区分「steer 成功」与「落队列」两种落点(现 `session-queue.ts:97-110` 有 try/catch 分支,可在两支各记一条)。
7. **Fix A 之后的历史形态**(待验,承接 005 §7):Fix A 上线后,毒化 tool_call 从后续请求中消失,但 jsonl 里已发生的 3 次 400 仍在;backfill 必须照实回放(它们确实发生过),不能「因为修好了就抹掉」——否则 DAG 会撒谎,违背「树不撒谎」的立论根基。
8. **范围蠕变**(中):「图成为基础设施」很容易长成当年那套重基建。防线即 §9 非目标 + §11 拍板清单;任何新增表/新增 API 先对照 §5「明确不回答」。

---

## 附:独立巡检脚本(只读,验收 10 用)

```bash
cd /home/ilio/.imboss/agent/sessions/chats/11
python3 - <<'EOF'
import json, glob
for f in sorted(glob.glob('*.jsonl'), key=lambda x: int(x.split('.')[0])):
    L = open(f, 'rb').read().split(b'\n')
    if L and L[-1] == b'': L.pop()
    empty, err, zero, bad = [], [], [], []
    for i, b in enumerate(L, 1):
        try: o = json.loads(b)
        except Exception: bad.append(i); continue
        m = o.get('message') or {}
        for it in (m.get('content') or []):
            if isinstance(it, dict) and it.get('type') == 'toolCall' \
               and not str(it.get('name') or '').strip():
                empty.append(i)
        if m.get('stopReason') == 'error': err.append(i)
        u = m.get('usage') or {}
        if u and u.get('totalTokens') == 0 and m.get('role') == 'assistant':
            zero.append(i)
    print(f"{f} lines={len(L)} emptyName={empty} errorTurns={err} usageZero={zero} badLines={bad}")
EOF
```

2026-10-19 08:12 实测:`1/2/3/5/6.jsonl` 四项全空;`4.jsonl` = `emptyName=[124] errorTurns=[127,130,133] usageZero=[127,130,133] badLines=[]`(与 004/005 记录一致,@4 仍未被再次唤醒)。
