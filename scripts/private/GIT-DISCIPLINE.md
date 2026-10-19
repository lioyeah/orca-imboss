# Git 纪律（scripts/private）

本文件是 orca-imboss 私有分支上**所有 git 写操作**的唯一纪律来源。

- 适用对象：`mine` 分支上的全部协作者（@1 / @3 / @5 / @6，以及老板本人）。
- 出处：大总管消息 id 167（2026-10-19）立规，id 170 追加 @6 的三条加固铁律。核心案例是 @1 当天的一次真实 `--amend` 事故（见 §8）。
- 编写标准：**一个没经历过这些事故的新人，读完本文不应再踩坑。** 因此每条规则都写清了「为什么」和「踩了会怎样」，不只是「不准」。
- 与其它文件的关系：`scripts/private/README.md`（分支与私有层规则）、`scripts/private/issues/000-template.md`、
  `scripts/private/issues/VERIFY-RUNBOOK.md` 里各自的纪律小节继续有效，本文把它们合并、补全并作为仲裁依据。

---

## 0. 为什么这个仓库需要这份文件

三条现实约束叠加，决定了 git 操作的默认姿态：

1. **多人并行、同一分支、同一工作区。** @3 / @5 / @6 与你在 `mine` 上同时提交，HEAD 在两次命令之间就可能变成别人的 commit。
2. **老板会把未完成的改动留在暂存区。** 历史上曾一次暂存 21 个文件（落账为 `3e5fcee`，21 files, +593/−2187）。这些 WIP 不是你的，任何时候都不许被整体操作。
3. **有一台 live 实例在任何时候都不许被惊扰。** PID 261970、数据根 `~/.imboss`（见 §10）。

所以默认姿态是：**只碰自己那一个路径，写完立刻核验，不确定就停下来问大总管。**

---

## 1. 红线（任何情况下都不做）

| # | 禁止的操作 | 为什么 |
|---|---|---|
| 1 | `git add -A` / `git add .` / `git add scripts/private/` | 会把队友未提交的改动、证据截图、别人的临时文件一起卷进来。本案已有实例：@5 曾差点用 `git add -N scripts/private/issues/evidence/002-*.png` 误收别人的 steward 截图，改为显式列 8 个文件名。 |
| 2 | 裸 `git commit`（不带路径）/ `git commit -a` | 同上，且会把工作区里所有已跟踪文件的改动一起提交。 |
| 3 | `git stash` / `git checkout --` / `git checkout <branch>` / `git reset` / `git rebase` 碰到他人 WIP | 会直接丢掉或改写队友与老板的未落账改动。本案 @0 曾因一度出现此类风险而下达冻结令（id 130）。 |
| 4 | 对老板暂存区做任何整体操作（`git reset` 清空 index、`git checkout --`、`git restore --staged` 等） | 老板的 21 个暂存 WIP 是唯一副本，丢了无法复原。 |
| 5 | 通配符 / 目录名出现在 `git add` 参数里 | 同 #1，见 §7。 |
| 6 | 默认使用 `--amend` | 见 §3，这是今天事故的直接成因。 |
| 7 | 动 live 实例相关的一切 | 见 §10。 |
| 8 | 提交到 `main` | `main` 只做 upstream 镜像，`git merge --ff-only upstream/main` 是唯一允许的写操作。 |

---

## 2. 提交自己的文件：唯一正确姿势

```sh
git add -N <你的文件>            # 只此一个路径，显式全名
git commit --only <同一个路径>   # 只提交这一个文件
```

**为什么是这个组合：**

- `git add -N <路径>` 只在该路径上登记「意图添加」，index 里是一个空 blob，**不会把任何别人的改动带入暂存区**。
  实证：新文件执行后 `git status --porcelain` 显示 ` A`（注意是「空格 + A」，即未暂存的新增）。
- `git commit --only <同一个路径>` 让本次提交只取该路径的**工作区内容**，其余路径一律沿用 HEAD，与 index 里暂存了什么无关。
  实证：探针仓库里 `f.txt` 处于 `MM`（index=v2、工作区=v3）时，`git commit --only f.txt` 提交的内容是 `v3`，且只动 `f.txt`，`g.txt` 未被卷入。

**提交后必须立刻三项核验**（缺一项就不算提交完）：

```sh
git show --stat --format='' HEAD     # ① 只有你的文件，行数符合预期
git status --porcelain                # ② 应只剩别人的改动，没有你的
git diff --cached --stat              # ③ 应为空（除非老板正在暂存 WIP，则条数应与操作前一致）
```

③ 的「条数与操作前一致」是本案长期做法：历史上老板暂存区恒为 21 个文件，提交前后各数一次
（`git diff --cached --name-only | wc -l`），数字不变即证明没碰别人的东西。

---

## 3. `--amend`：默认禁止

`--amend` 会**静默改写 HEAD 这个 commit**。危险不在于 amend 本身，而在于：

> **「我以为 HEAD 是我的 commit」在并行仓库里不成立。**

### 今天的事故（完整机理，见 §8）

@1 执行 `git commit --only <蓝图> --amend` 时，HEAD 恰好还是他自己的蓝图 commit，一切正常。
几分钟后他再次用同一句式修正蓝图，但此时 @6 已经在他之后落了 `227d79d`——
**HEAD 已经变成 @6 的 commit**。这一次 amend 把 @6 的勘误和自己的蓝图修改挤进了同一个 commit
（`c5e85b2`，2 files，commit message 还是 @6 的）。

同一条命令，两次执行，一次安全一次灾难，差别只在于两次之间 HEAD 被队友改写了。

### 唯一例外（同时满足两条）

1. **操作前一刻**执行 `git log -1 --format=%h`，确认输出的 sha 与 subject **就是**你要改的那个 commit；
2. 改完立刻 `git show --stat --format='' HEAD` 核验：文件清单必须与你的预期逐项一致。

只满足 1 不满足 2 等于没核验。

### 3.1 amend / reset / rebase 的三条铁律（@6 加固，已成团队惯例）

任何 `--amend` / `reset` / `rebase` 之前，先做这三件事；**有一条没做到就不要执行**：

| # | 铁律 | 命令 | 防的是什么 |
|---|---|---|---|
| 1 | **落盘 HEAD 身份** | `git rev-parse HEAD > /tmp/pre-amend.sha` | 「HEAD 在两次命令之间被队友改写」是竞态，靠记忆核对在忙时一定会漏 |
| 2 | **前后各打一个 ref** | 操作前 `git branch backup-<事由> <sha>`；改写/恢复完成后再打一个 ref | 留退路，也留证据 |
| 3 | **用 diff 空输出自证内容守恒** | `git diff <ref前> <ref后> --stat` | 无输出 = 逐字节一致；有输出 = 你必须能逐行解释每一行差异 |

铁律 3 的证法就是 @1 这次事故恢复所用的证法（`git diff backup-pre-recovery HEAD --stat` 无输出）。
固化为惯例：**任何改写历史的操作，前后各一个 ref，diff 空输出（或与预期完全一致）才算做完。**
核验通过后才删 backup ref。

---

## 4. 想改自己已经提交的 commit：按优先级三条路

### 路 A（首选，零风险）：再补一个后续 commit

```sh
git add -N <路径> && git commit --only <路径> -m "docs: 修正上一处笔误"
```

不改写任何历史，不碰任何 sha，队友的记录全部保持有效。**除非有明确理由要求单 commit 干净，否则永远用这条路。**
本案最终就是这么收场的（`ad02ab2` + `c6b1e74` 两个单文件 commit）。

### 路 B（确实需要单 commit 时）：`--fixup` + `--autosquash`

```sh
git commit --fixup=<目标sha>                 # 生成 "fixup! <目标subject>" 提交
GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <目标sha>^
```

显式指定目标 sha，**不依赖 HEAD 身份**，这是它比 `--amend` 安全的唯一原因。

**但 rebase 会改写 `<base>..HEAD` 之间所有 commit 的 sha，包括队友的。** 实证：探针仓库中队友 commit
`352ea13` 在 autosquash 后变成 `d0d66f5`。因此**只有同时满足以下两条才可用**：

- 目标 commit 就是 HEAD，或者它之后的所有 commit 都是你自己的；
- 你已经知道哪些记录引用了将被改写的 sha（聊天报告、issue 文档里的 sha 引用），并准备同步更正。

另外：`mine` 跟踪 `origin/mine`，本地领先 40 个 commit。一旦改写历史，若已推送则还需要 force-push——
这会让队友本地与 origin 分叉。**不满足上述条件，或不会用，停下来问大总管，不要自己试。**

### 路 C：问大总管，由他给精确命令。

本案的提交策略（尤其是涉及老板暂存 WIP 时）一直由大总管拍板后下发精确命令，这个惯例保持不变。

---

## 5. `MM` 状态：为什么 `commit --only` 在某些路径上是危险的

`git status --porcelain` 的两个字母分别是「index vs HEAD」和「工作区 vs index」的状态。

| 状态 | 含义 | 能否 `commit --only <该路径>` |
|---|---|---|
| `??` | 未跟踪新文件 | ✅ 安全 |
| ` M` | 只有工作区改动（index 与 HEAD 一致） | ✅ 安全——工作区内容相对 HEAD 只差你自己的编辑 |
| ` A` | `git add -N` 登记的意图添加 | ✅ 安全 |
| `MM` | index 与 HEAD 不同，**且**工作区又与 index 不同 | ⛔ **危险** |
| `M ` / `A ` / `AM` / `R ` / `D ` | 已暂存、或暂存与工作区不一致 | ⛔ **危险** |

`MM` 的危险机理：`commit --only <路径>` 提交的是**工作区内容**，而 MM 状态下的工作区内容 =
「别人暂存的 WIP」+「你的编辑」的叠加。于是你的 commit 会把别人的 WIP 行一起带走，还顶着你的
commit message。本案实例：2026-10-19 上午，4 个 #002 修复路径中 3 个处于 `MM`（老板暂存区里本来就有
它们的 WIP 版本，@5 的编辑叠在上面），大总管因此下达冻结令（id 130）；后来老板亲自把 21 个暂存 WIP
落成 `3e5fcee`，4 个路径全部变干净，风险才消失。

**操作前必做**：`git status --porcelain -- <你打算提交的路径>`，只接受上表前三行。

---

## 6. 回滚的正确姿势

**永远不要用 `git checkout --` / `git restore`**：它按 index/HEAD 覆盖工作区，会把同一文件上属于
别人的改动一起抹掉，且不可恢复。

正确姿势是先存档再反做：

```sh
git diff -- <路径> > /tmp/rollback.patch          # 存档
git apply -R --check /tmp/rollback.patch          # 干跑校验
git apply -R /tmp/rollback.patch                  # 反做
```

`--check` 一步不能省：它是「这个 patch 现在还能干净反做吗」的唯一确认。

---

## 7. 通配符陷阱

`git add` 的参数里**永远写显式完整文件名**，不写通配符、不写目录。

```sh
# ❌ 会误收别人的文件
git add -N scripts/private/issues/evidence/002-*.png
git add -N scripts/private/issues/

# ✅ 显式列出，逐个确认
git add -N scripts/private/issues/evidence/002-max-chat.png \
           scripts/private/issues/evidence/002-max-employees.png
```

本案实例：@5 主动规避了这个坑——`002-*.png` 会连别人的 steward 截图一起收，他改成显式列 8 个文件名。

顺带一条相关的：证据截图（`scripts/private/issues/evidence/` 下的 png）默认是 untracked 的，
提交时随 issue 正文一起 `git add -N` + `commit --only`，同样显式列名。

---

## 8. 事故标准范式（核心案例：2026-10-19 @1 的 amend 事故）

**发生了什么**：@1 修蓝图 §9.1 时用了 `git commit --only <蓝图> --amend`。此时 @6 已在他之后落了
`227d79d`，HEAD 变成了 @6 的 commit，于是 amend 把 @6 的勘误 + @1 的蓝图修改挤进同一个 commit
（`c5e85b2`，2 files，message 还是 @6 的）。

**他怎么恢复的（这就是标准范式）**：

```sh
git branch backup-pre-recovery c5e85b2      # ① 先留证：打 backup ref
git reset --mixed HEAD~1                    # ② 退回上一个 commit，两个文件的改动完整回到工作区
git commit --only <蓝图> --amend …          # ③ 分别重建：蓝图 amend 回自己的 commit
git commit --only <@6 的 ops 文档> …        #    勘误按 @6 原始 message 单独重建
git diff backup-pre-recovery HEAD --stat    # ④ 自证内容守恒：无输出 = 逐字节一致
git branch -D backup-pre-recovery           # ⑤ 核验通过后才删 backup ref
```

**结果**：`ad02ab2`（蓝图，455 insertions, 1 file）+ `c6b1e74`（@6 勘误的等价重建，16 insertions,
1 file）。`git diff backup-pre-recovery HEAD --stat` 无输出，两个文件的最终内容与事故前逐字节一致。
全程未用 stash/checkout，未碰任何他人路径。@6 随后独立只读核验通过（id 165）。

**范式提炼——万一再出 git 事故，按这五步走**：

1. **先留证**：`git rev-parse HEAD > /tmp/pre-amend.sha` 落盘 + `git branch backup-<事由> <sha>` 打 ref（或 `git diff > /tmp/x.patch`），在任何恢复动作之前；
2. **恢复**，优先用非破坏性手段（`reset --mixed` 保留工作区），绝不 stash/checkout；
3. **核验逐字节一致**（`git diff <backup> HEAD --stat` 空输出，或 patch 内容比对）；
4. **回报**大总管，说清机理、影响面、恢复方式、核验证据；
5. **补纪律**，把坑写回本文档。

事后按 §3.1 铁律 2/3 补齐「后一个 ref」并用 `git diff <前> <后> --stat` 空输出自证，才允许删 backup ref。

---

## 9. 每次 git 写操作的自检清单

提交前：

- [ ] `git status --porcelain` —— 看清全局，确认哪些是别人的改动
- [ ] `git status --porcelain -- <我的路径>` —— 只接受 `??` / ` M` / ` A`（见 §5）
- [ ] `git log -1 --format='%h %s'` —— 知道 HEAD 现在是谁的 commit（**每次写操作前都重新看，不要凭记忆**）
- [ ] 命令里的路径是显式完整文件名，无通配符、无目录
- [ ] 若要用 `--amend` / `reset` / `rebase`：已按 §3/§4 判定可用，且 §3.1 三条铁律全部做到
      （`git rev-parse HEAD > /tmp/pre-amend.sha` 落盘 + 前后各打一个 ref）

提交后：

- [ ] `git show --stat --format='' HEAD` —— 只有我的文件
- [ ] `git status --porcelain` —— 我的改动已消失，别人的还在
- [ ] `git diff --cached --stat` —— 空，或暂存区条数与操作前一致

---

## 10. 与 live 实例 / 测试环境相关的操作红线

这些不是 git 规则，但同属「不许惊扰现场」，合并在此备查：

| 对象 | 红线 |
|---|---|
| live 实例 PID 261970 | 不许 kill / restart / attach |
| `~/.imboss` | 不许写、不许改 mtime（复测前后用 `stat -c '%y' /home/ilio/.imboss` 比对） |
| `/home/ilio/.config/orca-imboss` | 不许动（live 实例的 user-data-dir） |
| `/tmp/.mount_imbosspWR5iY` | 不许动（AppImage 挂载点） |
| `pkill imboss` / `pkill orca` / `pkill electron` | **一律禁止**——会误杀 live 实例 |
| `pkill -f "remote-debugging-port=9224"` | **禁止**——会杀掉命令行里含该字符串的自己的 shell（本案真实事故：exit 143） |

UI 复测一律走 `scripts/private/run-test-env.sh`（独立 HOME `~/.imboss-ui-test`、CDP 9224、
pidfile `~/.imboss-ui-test/imboss-test.pid`），`--stop` 只杀自己的 PID 与自己的端口。
构建（`pnpm run build`）必须在真实 HOME 下执行——pnpm 是 mise shim，换 HOME 会报
`mise ERROR pnpm is not a valid shim`；数据隔离只发生在启动层，因为 `getDataRoot()`
（`src/main/data-dir.ts`）是运行时才读 `~/.imboss` 的。

---

## 11. 一页速查

```
提交   git add -N <文件> && git commit --only <同一文件>
核验   git show --stat HEAD | git status --porcelain | git diff --cached --stat
红线   add -A / 裸 commit / stash / checkout -- / reset / rebase 他人 WIP / --amend
 amend  默认禁止；例外=操作前一刻 git log -1 --format=%h 确认 HEAD 身份 + 事后 show --stat
 铁律   rev-parse HEAD > /tmp/pre-amend.sha 落盘；前后各打一个 ref；diff 空输出自证内容守恒
 改提交 首选补后续 commit；要单 commit 用 --fixup=<sha> + rebase --autosquash（仅当目标是 HEAD）
 危险态 MM / M / A / AM / R / D —— 先 git status --porcelain -- <路径> 再动手
 回滚   git diff -- <路径> > /tmp/x.patch && git apply -R --check && git apply -R
 事故   留证(backup ref/patch) → 恢复 → 核验逐字节一致 → 回报 → 补纪律
 禁碰   PID 261970 / ~/.imboss / ~/.config/orca-imboss / /tmp/.mount_* / 宽泛 pkill
```

---

*本文档自身即按 §2 的姿势提交：`git add -N scripts/private/GIT-DISCIPLINE.md` + `git commit --only` 同一路径。*
