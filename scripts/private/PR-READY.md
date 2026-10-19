# PR-READY — 上游 PR 就绪门禁

- 作者：employee 2（上游卫生评审员）
- 委派：@0（消息 id 185，2026-10-19）
- 定位：**常驻文档**，与 `scripts/private/GIT-DISCIPLINE.md` 同级。`AGENTS.md` §1 用文字描述了分支模型，本文把它变成「一个改动能不能作为上游 PR 交出去」的可执行门禁。
- 关联：`AGENTS.md` §1/§2.4、`scripts/private/README.md`、`scripts/private/GIT-DISCIPLINE.md`（`9b8c34b`）、`scripts/private/ops/005-toolcall-sanitize-pr-spec.md`（`581db77`）、`scripts/private/ops/004-employee4-session-poison.md`（`b1db16d`）
- 本文所有命令均在 2026-10-19 的 `mine` 工作区实测过；标「待验」的是没跑过的。

---

## 0. 这份文件管什么，不管什么

**管**：任何打算开上游 PR 的分支。当前队列有两个 incoming PR——Fix A（`feat/toolcall-sanitize`）和事件因果 DAG。

**不管**：`mine` 上的日常 git 写纪律（归 `GIT-DISCIPLINE.md`）。

**两者边界**：`GIT-DISCIPLINE.md` §1–§7（禁 `add -A`、禁裸 commit、MM 危险态、通配符陷阱、`--amend` 禁令）防的是「多人共用一个工作区 + 老板暂存 WIP」。在**按 §3 开的独立 worktree** 里施工时这些风险不存在——那里没有队友、没有老板 WIP，`git add -A` 和 `--amend` 都是安全的。**但仍然生效的两条**：① 绝不提交 `main`；② §10 的 live 实例红线（PID 261970、`~/.imboss`、`~/.config/orca-imboss`、`/tmp/.mount_*`、禁宽泛 `pkill`）。

---

## 1. 事实基线（已核验，2026-10-19）

写门禁前先把「私有」的边界钉死，否则门禁本身会漏：

| 事实 | 值 | 核验方式 |
| --- | --- | --- |
| fork remote | `origin` = `lioyeah/orca-imboss` | `git remote -v` |
| 上游 remote | `upstream` = `sethyuan/orca-imboss` | `git remote -v` |
| `main` 的身份 | `main` == `origin/main` == `upstream/main` == `b3018c0d4d5c7832bd2f0f48f26d224cf29ec5e9` | `git rev-parse main upstream/main origin/main` |
| 私有层目录 | `src/renderer/private/` = `index.ts` / `theme.css` / `overrides.css` / `states.css` | `ls src/renderer/private/` |
| 私有层唯一 importer | `src/renderer/main.tsx:13` — `import "./private";`（必须保持最后一个 import） | `grep -rn 'renderer/private' src/` |
| 私有 token 全集 | 13 个，全部 `--imb-private-` 前缀：`accent-text`、`bubble-other`、`elev-overlay`、`h-control`、`h-control-sm`、`h-row`、`layer`、`measure`、`motion-enter`、`motion-pulse`、`motion-spin`、`state-dim`、`tint-current` | `grep -rhoE '\-\-imb-private-[a-z0-9-]+' src/renderer/private/ src/renderer/styles/tokens.css \| sort -u` |
| 私有脚本目录 | `scripts/private/` 整体只存在于 `mine` | `git ls-tree main -- scripts/private` → 空 |
| 测试基础设施 | **没有测试运行器**。`package.json` scripts 只有 `typecheck` / `build` / `dev` / `dist*` / `i18n:prune` / `db:export|import` | `node -e "…require('./package.json').scripts"` |
| 上游文件自身不 prettier 干净 | `git show main:src/renderer/components/nav/index.css \| npx prettier --check --stdin-filepath …` → **exit 1** | 见 §2 G4，这条决定了 prettier 不能当门禁用 |

**这条基线最重要的一条结论**：`scripts/private/` 和 `src/renderer/private/` 一样是私有的。一个 PR 只要 diff 里出现这两个前缀的路径，就已经出局——不需要再看内容。

---

## 2. 六道门禁

按顺序跑。任一门禁不过 → 不许开 PR。G1/G2/G3 是**硬门禁**（有输出即失败），G4/G5 是**半自动**（有输出即需人工裁决），G6 是证据门禁。

范围变量统一用 `<base>`，默认 `main`。所有 diff 一律用**三点** `main...HEAD`（= `git diff $(git merge-base main HEAD) HEAD`）：`main` 被 upstream 推进后，两点 `main HEAD` 会把别人的同步 commit 也算进你的 diff，三点不会。

### G1 零私有 import（硬门禁）

```sh
# G1a — 本 PR 新增的私有 import（added lines 扫描）
git diff main...HEAD -- src/ | grep -E '^\+' | grep -v '^+++' \
  | grep -nE 'renderer/private|"\./private"|'"'"'\./private'"'"''
# 通过判据：零输出
```

G1a 只看新增行，会漏掉「在 `mine` 上就存在、被你的分支原样带过来」的私有依赖。所以必须再跑 G1b——**这才是「可重切」的真正测试**：

```sh
# G1b — 本分支触碰的每个文件，其分支版本全文不得引用私有层
git diff --name-only main...HEAD -- src/ | while read -r f; do
  git cat-file -e "HEAD:$f" 2>/dev/null || continue
  git show "HEAD:$f" | grep -qE 'renderer/private|"\./private"|'"'"'\./private'"'"'' && echo "FAIL $f"
done
# 通过判据：零输出
```

**实测（`mine` 的 `main...HEAD`）**：G1b 输出 `FAIL src/renderer/main.tsx`——即 `mine` 整体不可重切，与预期一致。在一个从 `main` 干净切出的 `feat/*` 上，G1a/G1b 都应零输出。

**失败怎么办**：把私有依赖从分支上去掉（§3 重切），或者把「这个依赖本身」先提案上游（005 规格 §5 论证 Fix A 走的是前一条路：它压根不碰渲染层）。

### G2 零私有 token（硬门禁）

与 G1 同构，两个扫描都要跑，模式串换成 `imb-private-`：

```sh
# G2a — 新增行
git diff main...HEAD -- src/ | grep -E '^\+' | grep -v '^+++' | grep -n 'imb-private-'
# G2b — 分支版本全文
git diff --name-only main...HEAD -- src/ | while read -r f; do
  git cat-file -e "HEAD:$f" 2>/dev/null || continue
  git show "HEAD:$f" | grep -q 'imb-private-' && echo "FAIL $f"
done
```

**实测（`mine`）**：G2b 输出 `FAIL src/renderer/private/{overrides,states,theme}.css` 三个文件——正是私有层自身。

**为什么必须扫全文**：`--imb-private-*` token 是在 `theme.css` 里定义的，上游文件一旦用了它，在 `main` 上就是未定义变量，视觉静默退化且不报错。这类失败在 `mine` 上永远看不见，只有 G2b 能拦住。

**注意反向情况**：PR 删掉了对私有 token 的引用是好事，但 diff 的 added-lines 扫描看不到——仍以 G2b 的零输出为准。

### G3 零私有路径（硬门禁）

```sh
git diff --name-only main...HEAD | grep -E '^(src/renderer/private/|scripts/private/)'
# 通过判据：零输出
```

**实测（`mine`）**：47 个文件命中（`scripts/private/**` 全家 + 渲染层私有文件）。

**这一条最省事也最容易忘**：`scripts/private/` 是文档、脚本、issue、证据图、运行手册的所在地，日常提交极其频繁，很容易在「顺手带上」时进 PR diff。@5 在 #002 就主动规避过同型陷阱——`git add -N scripts/private/issues/evidence/002-*.png` 的通配会误收别人的 steward 截图（`GIT-DISCIPLINE.md` §7）。PR 场景下同理：证据图、蓝图、issue 文档一律不进 PR。

### G4 diff 卫生：禁重整上游文件（半自动，人工裁决）

`AGENTS.md` §2.4：「Never Reformat Upstream Files——不要在碰过的上游文件上跑整文件格式化，那会把一行冲突变成整文件冲突。」

**第一条：prettier 不能当门禁，反而是陷阱。** 实测 `main` 自己的 `src/renderer/components/nav/index.css` 就不过 `prettier --check`（exit 1）。在一个上游自身不干净的仓库上跑 `prettier --write`，等于对每个 PR 强制整文件 reformat。**本仓库 G4 的执行方式是 diff 审读，不是工具。**

**第二条：跑形状启发式，把可疑文件拎出来给人看。**

```sh
git diff --numstat main...HEAD -- src/ | while IFS=$'\t' read -r add del f; do
  git cat-file -e "main:$f" 2>/dev/null || continue      # 只审上游已有文件
  base=$(git show "main:$f" | wc -l); tot=$((add+del))
  if [ "$base" -gt 0 ] && [ "$tot" -gt $((base*3/5)) ] && [ "$tot" -gt 20 ]; then
    printf 'FLAG %-55s changed=%s baseline=%s\n' "$f" "$tot" "$base"
  fi
done
# 有输出 = 该文件改动量超过上游版本的 60%，需人工确认是语义改动还是 reformat
```

**实测（`mine`）**：唯一命中 `src/renderer/components/list-pane/index.css changed=51 baseline=47`——而它是真实的语义改动（选择器搬迁 + 取值变更），不是格式化。**所以这条门禁的产出是「送审清单」而不是「失败判定」**：我（@2）逐个打开被 FLAG 的文件确认 hunk 性质。

**人工裁决的通过判据**：每个 FLAG 文件的 diff 里，每一行都能说出「改了什么行为」；说不出的行就是 reformat，退回。

### G5 提交结构（半自动）

```sh
git log --oneline main..HEAD                 # 主题数 = commit 数，一眼看出一 topic 一 commit
git merge-base --is-ancestor main HEAD && echo "cut from main: OK"
```

- **一 topic 一分支一 commit**（cherry-pick 后 squash，见 §3）。
- `cut from main: OK` 不成立 = 分支不是从 `main` 切的（常见于从 `mine` cherry-pick 后忘了 reset 基线），上游 PR 会带上私有 commit。
- commit 数 > 1 且主题可拆 → squash 后再交。
- **反面教材（本仓库真实案例）**：2026-10-18 那批 21 文件 +593/−2187 的暂存 WIP，落到 `3e5fcee`。它 20/21 个文件在改动后与 `main` **逐字节相同**，唯一残差是 `src/renderer/components/nav/index.tsx` 里 `GRAPH_VIEW_ENABLED` 那 13 行私有 nav 项。它不是功能增量，是私有层回退——G3 会直接判负，G1/G2 亦然。**这个案例说明 G5 的真正作用：在动手前就发现「这个改动没有上游价值」，省下的是整轮重切。**

### G6 证据门禁

PR description 必须附：

| 证据 | 命令 | 现状 |
| --- | --- | --- |
| typecheck 绿 | `pnpm run typecheck`（= `typecheck:node` + `typecheck:web` 两个 tsconfig） | 仓库支持 |
| build 绿 | `pnpm run build`（内含 typecheck + electron-vite build） | 仓库支持 |
| 测试证据 | — | **仓库没有测试运行器**，见下 |
| 关联文档 | issue / 设计文档 / 事故文档的路径 + commit sha | 团队既有实践 |

**关于「测试证据」的缺口（需 @0 拍板，不是我能定的）**：`package.json` 没有 `test` 脚本。Fix A 的规格 §6 给了 5 条单元 + 5 条集成验收（集成用本地 OpenAI 兼容 stub 确定性复现畸形 tool call，挂钩点取证在 `src/main/agent/providers.ts:65-72` 的 `kind:"custom"` + `baseUrl`）。在没有测试运行器的仓库里，这些要么落成一个**新脚本 + 新增 devDependency**（范围决策，需 @0 决定），要么在 PR description 里以「人工执行步骤 + 实测输出」的形式交付。**在 @0 拍板前，我不接受「测试已通过」这种无出处的声明。**

---

## 3. re-cut 操作手册

`README.md` 给的姿势是 `git checkout -b feat/<topic> main` + `git cherry-pick` + squash。在多人共用主工作区的前提下，正确做法是**独立 worktree**：

```sh
# ① 从 origin/main 起新 worktree（不是本地 main，避免本地 main 落后时的假象）
git fetch origin
git worktree add ~/.cache/imboss-worktrees/feat-<topic> -b feat/<topic> origin/main

# ② 进去装依赖、施工
cd ~/.cache/imboss-worktrees/feat-<topic>
pnpm install

# ③ 把 mine 上的主题 commit 摘过来，压成一个
git cherry-pick <sha1> <sha2> …
git reset --soft origin/main            # 全部改动回到暂存区，历史清空
git commit -m "<按 §4 规范>"

# ④ 门禁（在 worktree 内跑）
git diff --name-only origin/main...HEAD | grep -E '^(src/renderer/private/|scripts/private/)'   # G3
# … G1a/G1b G2a/G2b G4 G5 …
pnpm run typecheck && pnpm run build                                                            # G6
```

**为什么必须 worktree**：主工作区里有 @5 在施工 `src/renderer/components/modules/employees/employee-detail/{index.tsx,index.css}`（当前 `git status` 为 ` M`），还有 3 张未跟踪的 003 证据图。`git checkout -b feat/x main` 会把主工作区切到 `main`，那些改动要么被带错分支要么触发 `GIT-DISCIPLINE.md` §1 红线 3。本仓库已有 worktree 实践可参照：`~/.local/share/opencode/worktree/…/core-events`（`refactor/core-and-events`）、`…/graph-view`（`feat/graph-view`）。

**worktree 内的 git 纪律简化但不清零**：没有队友、没有老板 WIP → `GIT-DISCIPLINE.md` §1–§7 基本不适用；**但「绝不提交 `main`」「live 实例红线（§10）」照旧**，回滚仍用 patch 姿势。

---

## 4. commit message 规范

```
<type>(<scope>): <subject>

<body>
```

- **type**：`feat` / `fix` / `refactor` / `docs` / `perf` / `test` / `chore`。
- **scope**：用目录名，不用自造词——`agent`、`ui`、`graph`、`db`、`private`（仅 `mine`）、`ops`、`issues`。
- **subject**：≤ 72 字符，命令式，结尾不加句号。**必须能单独读懂**——上游维护者只看 subject 决定要不要点开。
- **body 必含四项**（缺一项我打回）：
  1. **改了什么**（一行一条，带 `file:line`）；
  2. **为什么**（问题陈述或动机，能链到 issue / 事故文档 / 设计文档）；
  3. **怎么验的**（实测值，不是「已测试」）；
  4. **非目标**（这个 PR 明确不做什么，防范围膨胀）。
- **语言**：英文（上游是 `sethyuan/orca-imboss`，英文社区）；团队内部报告用中文，不混。
- **参照样板**：@5 的 `9aaf0a9`（feat(ui)，含实现要点 + 两个模块分别表述「恢复」与「纯新增」）、@1 的 `ad02ab2`。

---

## 5. 证据清单（PR description 模板）

```markdown
## What
<一段话>

## Why
<问题陈述；链到 issue / ops 文档，带 sha>

## How it was verified
- typecheck: `pnpm run typecheck` → 绿（node + web 两个 tsconfig）
- build: `pnpm run build` → 绿
- <测试证据；若仓库无测试运行器，写明人工步骤 + 实测输出>

## Non-goals
<明确不做的事>
```

---

## 6. 我的评审程序（incoming PR）

Fix A 是第一个，事件 DAG 是第二个。按这个顺序过，每一条都要落到「过/不过 + 证据」：

1. **分支身份**：`git merge-base --is-ancestor origin/main HEAD` 必须 OK；`git log --oneline origin/main..HEAD` 主题单一。
2. **G3 私有路径**：零输出。
3. **G1b 私有 import**（全文扫描，不是 added-lines）：零输出。
4. **G2b 私有 token**（全文扫描）：零输出。
5. **G4 diff 卫生**：跑形状启发式，逐个打开 FLAG 文件确认每行都是语义改动。
6. **正确性**：按 issue / 设计文档的验收标准逐条走；对 Fix A，规格 §6 的 5+5 条是硬清单；对待验项（005 §7 的 6 项）要看 PR 里是否明确标注了状态，不标注视为未做。
7. **死代码与悬挂引用**：删了东西就 grep 被删符号（import / IPC 通道 / 类型 / 常量 / i18n key）。这条有本仓库反面教材：2026-10-18 那批删除 `src/main/graph/` 全家的改动，我逐项核过——`src/main/ipc/index.ts:7` 的 `registerGraphHandlers` 来自 `./graph`（即 `src/main/ipc/graph.ts`，未删）、`src/shared/types/index.ts:8` 仍导出仍在的 `types/graph.ts`、`depends_on` 从常量/联合类型/发射端/消费端/CSS 全链路清干净、zhCN 从未加过对应 key——全部通过，结论「无悬挂引用」。
8. **G6 证据**：typecheck/build 绿 + §5 模板齐。
9. **提交结构**：单 commit、message 符合 §4。
10. **结论**：`ready` / `ready-with-notes` / `blocked（列必须改的点）`。**只有 `ready` 才开 PR。**

**评审产出**：报告回 @0，按严重程度列 `file:line`，并明确说「能否从 `main` 重切、还差什么」。

---

## 7. 两个 incoming PR 的预填项

### 7.1 Fix A — `feat/toolcall-sanitize`（@7）

规格在 `scripts/private/ops/005-toolcall-sanitize-pr-spec.md`（`581db77`），事故取证在 `004-employee4-session-poison.md`（`b1db16d`，行号勘误在 `c6b1e74`）。

- **预期改动面**：`src/main/agent/` 新增一个扩展工厂 + `src/main/agent/session.ts:517` 的 `extensionFactories` 加一项。**这条天然过 G1/G2/G3**——主进程代码，不碰渲染层。
- **规格 §5 已自证 PR-ready**，但我要独立复核，不接受规格的自我论证。
- **重点审**：
  - handler 内部 try/catch + error 日志——`runner.js:1076-1090` 会吞掉 handler 异常并放行原 payload，清洗会**静默失效**（规格 §7 第 4 条已实证）。这是 Fix A 的第一验收项。
  - 幂等性（同一 payload 二次清洗返回 `undefined`）——「清洗+重试一次」不炸的前提。
  - 不可变性（返回新对象，不原地改 `params`）——handler 是链式调用的。
  - `unregistered` 规则默认关闭（规格 §4.2 约束 3 + §7 第 1 条待验）。
  - 只动线上 payload，不写会话 jsonl（约束 4）。
  - 日志不打 tool arguments 全量（约束 5）。
- **规格 §7 的 6 项待验**：PR 里必须逐项标状态，未标视为未做。
- **范围**：Fix A only。Fix B（`pi-ai` 400 重试）是另一个上游 PR，看门狗、事件 DAG 都不在本 PR。

### 7.2 事件因果 DAG（@6 设计）

设计文档将是 `scripts/private/designs/006-event-dag-design.md`。

- **改动面会碰 `src/main/db/`**——注意 `AGENTS.md` §3：migrations 只进不退，dev build 碰 migration 会改本地库。这不是上游 PR 门禁问题，但是我的评审必问项。
- **硬约束**：不复活 `src/main/graph/` 那 765 行（`3e5fcee` 已拆）。若 PR diff 里出现 `src/main/graph/` 或 `src/renderer/components/modules/graph/`，先确认它是「新增轻量 DAG」还是「旧代码回流」——后者直接打回。
- **UI 不许回归**：renderer 图谱现有功能是消费方，后端地基改动不能破坏它。

---

## 8. 常见失败模式与处理

| 失败模式 | 症状 | 处理 |
| --- | --- | --- |
| 从 `mine` cherry-pick 忘了重切 | G1b/G2b/G3 命中；`git log main..HEAD` 出现私有 commit | §3 从 `origin/main` 重开 worktree 重摘 |
| 上游文件被顺手 prettier | G4 FLAG 且 hunk 说不清行为 | 退回重做；**不要** `prettier --write` 上游文件 |
| 证据图 / 蓝图 / issue 文档进 PR | G3 命中 `scripts/private/` | 从 PR commit 里剔除，私有文档留 `mine` |
| 删了东西没清引用 | 我评审第 7 条不过 | 按被删符号全仓 grep，补清 |
| 「测试已通过」无出处 | G6 不过 | 补可复跑命令 + 实测输出；仓库无测试运行器时见 §2 G6 |
| 分支不是从 `main` 切的 | G5 `cut from main` 不 OK | §3 重开 |
| 单 commit 里混多个主题 | G5 不过 | `git reset --soft origin/main` 后按主题拆 commit |

---

## 9. 一页速查

```
范围   git diff main...HEAD          # 三点，不是两点
 G1    私有 import   → G1a added-lines + G1b 分支版本全文，都要零输出
 G2    私有 token    → G2a + G2b，模式 'imb-private-'，都要零输出
 G3    私有路径      → grep -E '^(src/renderer/private/|scripts/private/)' 零输出
 G4    diff 卫生     → numstat/base>60% 启发式送审；prettier 不是门禁（main 自身不干净）
 G5    提交结构      → 一 topic 一 commit；merge-base --is-ancestor main HEAD
 G6    证据          → typecheck + build 绿 + §5 模板；仓库无测试运行器，需 @0 拍板
 重切   git worktree add ~/.cache/imboss-worktrees/feat-<topic> -b feat/<topic> origin/main
        cherry-pick → reset --soft origin/main → 单 commit
 纪律   worktree 内 §1–§7 基本不适用；「禁提交 main」+ live 红线照旧
 结论   ready / ready-with-notes / blocked —— 只有 ready 才开 PR
```

---

*本文档自身即按 `GIT-DISCIPLINE.md` §2 的姿势提交：`git add -N scripts/private/PR-READY.md` + `git commit --only` 同一路径。*
