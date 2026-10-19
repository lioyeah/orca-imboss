# UI Issue 验证 Runbook（@3 复测用）

复测对象：`scripts/private/issues/00X-*.md` 中每个 issue 的「验收标准」。
复测环境固定：隔离测试实例 `HOME=~/.imboss-ui-test`、CDP 端口 `9224`（`bash scripts/private/run-test-env.sh --status` 确认 RUNNING 与 PID）。
驱动方式：`CDP_PORT=9224 node scripts/private/cdp-eval.mjs --eval '<js>' [--shot out.png] [--dpr N]`。
纪律：所有截图与测量只写进 `scripts/private/issues/evidence/`；提交只用 `git add -N <路径>` + `git commit --only <同一批路径>`，绝不 `git add -A` / 裸 `git commit`；复测前记录 `ps -o pid -p 261970` 与 `stat -c '%y' /home/ilio/.imboss`，复测后复核一致。

## 通用前置（每个 issue 都做）

1. `git log --oneline -1` 记录被测 commit；`git status --short` 确认没有意外脏文件。
2. 确认测试实例在跑且 `--imb-private-layer` 为 1（私有层生效）。
3. 每个验收标准都要有**可引用的数值或截图**，不接受「看起来对了」。

## #001 图谱画布铺满（`001-graph-canvas-too-narrow.md`）

| 验收 | 复测方法 | 通过判据 |
| --- | --- | --- |
| single 布局模块铺满 | CDP：`.imb-graph-stage` / `.imb-graph` 的 `getBoundingClientRect().width`，同时读 `.imb-shell-content` 的 `grid-template-columns` | width == `.imb-contentpane` 宽度；computed 值不含 `310px` |
| 与窗口尺寸无关（常规/最大化/resize） | 三档视口（900 / 1262 / 1920）各测一次；最大化后、加载后 resize 后各测一次 | 三档均铺满，宽度差 == 视口差 − 导航宽 |
| 富数据下成立 | 用纯 UI 种 ~40 节点 / ~50 连线（不得只测 1 节点） | 节点全部落在舞台内，舞台宽度不变 |
| 其他 single-layout 表面 | 两个小应用（mini-app 也是 single）逐一进入 | 渲染正常，无 310px 挤压 |
| list-detail 模块无回归 | 对话 / 员工 / 定时任务 / 设置 / 统计逐一进入，读中栏 pane 宽度 | 中栏回到预期宽度（基础 300px 或私有意图值），无 regression |
| 不堆 `!important` | `grep -n 'imb-shell-content' src/renderer/private/overrides.css` | 无 `!important` 网格覆盖，或已限定 `:not(.imb-layout-single)` |

收尾：截图命名 `001-fixed-*.png`；issue 状态 → `fixed-verified`；处理记录追加一行。

## #002 中栏 + 号（`002-list-pane-plus-button.md`）

| 验收 | 复测方法 | 通过判据 |
| --- | --- | --- |
| ① 标题行右侧 + 号 | CDP：`.imb-pane-header-top` / `.imb-pane-actions` 存在且位于标题同一行 | 对话、员工各 1 个，36px 级控件 |
| ② 底部大按钮移除 | CDP：`.imb-pane-footer` 内无 `imb-btn-block` 主色按钮 | 两个模块 footer 均为空或已移除 |
| ③ 点击行为不变 | 点击 + 号：对话 → 列表出现新对话并被选中；员工 → 招募弹窗出现 | 与原底部按钮行为一致 |
| ④ tooltip + aria-label | 读按钮 `aria-label` 与 Tooltip 文本 | 等于 `t("New Chat")` / `t("Recruit")`，无新 i18n 键 |
| ⑤ 窄宽度不挤压 | 中栏 300px 下测量标题与搜索框宽度 | 标题不被截断、搜索框可输入 |
| ⑥ 其他 ListPane 消费者无回归 | settings / settings-providers / settings-mcp / settings-skills / cron / spend 逐一进入 | 无 actions 时不渲染空槽，布局与修复前一致 |
| ⑦ quiet 视觉 | 截图 + 读控件 class | 发丝线边框、ghost 态，与 `imb-icon-btn` 体系一致 |

注意：对话中栏搜索区现在是 SearchInput + TagSelect 两行，actions 必须与它共存不重叠。

## #003 员工名字/角色唯一一处（`003-employee-inline-edit.md`）

| 验收 | 复测方法 | 通过判据 |
| --- | --- | --- |
| ① 有且仅有一组 | CDP：`.imb-detail-head` 内 `.imb-detail-avatar-row` 的 `.imb-detail-avatar-info`（h2 + .imb-sub）为唯一显示；`.imb-field-row` 不含名字/角色 input | 0 号与非内置员工均如此；`.imb-field-row` 只剩系统提示词等原有字段 |
| ② 头像在名字/角色左侧 | CDP 取 `.imb-detail-avatar-row` 子元素 rect：avatar-wrap 与 `.imb-detail-avatar-info` 同一行，且 avatar 的 `right` < info 的 `left` | 同一 y 区间水平相邻（m00211 显式要求） |
| ③ hover 铅笔 + 原地编辑 | `Input.dispatchMouseEvent mouseMoved` 移到名字上 → `.imb-employee-edit-icon` 的 `opacity` 0→1；点 `.imb-employee-edit-line` → 出现 `.imb-employee-name-input`（autoFocus） | 铅笔 hover/focus 才出现；点击进入原地编辑，不开弹窗 |
| ④ 提交/取消 | Enter、失焦各测一次；Esc 一次；改后重启实例复核落库 | 值经 `scheduleSave({...form, name/role})` 落库；Esc 还原；无双重提交（`fieldDoneRef` 守卫） |
| ⑤ 0 号口径 | 0 号：点名字铅笔可编辑；角色位置无 `.imb-employee-edit-line`、纯 `.imb-sub` 只读 | 名字可编辑、角色无编辑入口 |
| ⑥ 头像更换不回退 | 点头像更换入口 | 浮层与修复前一致 |
| ⑦ 空值回退显示 | 清空名字提交 | 空值/no-op，显示回退到 `displayName` 占位（「未命名」） |
| ⑧ 窄宽度可用 | 右栏压缩到窄宽度（含 800×600） | 名字/角色/铅笔不折行重叠；`scrollWidth > innerWidth` 为 false |
| ⑨ quiet 视觉 + 键盘 | 截图 + Tab 聚焦 | 实测值：铅笔 `.imb-employee-edit-icon` = 14×14、`--imb-muted`、opacity 0→1（`--imb-motion-fast`）；编辑框复用 `.imb-input` + `--imb-focus-ring`；铅笔可 Tab 聚焦、Enter/Space 进入编辑 |
| ⑩ 命中区域 ≥24×24（@0 依 id 177 裁定新增） | CDP：量 `.imb-employee-edit-line` 的 computed padding + **`elementFromPoint` 网格打点**实测命中区（全局 reset 是 `* { box-sizing: border-box }`，14px 图标加 padding 不会放大命中盒，必须打点实测） | 命中区 min(w,h) ≥ 24，视觉仍 14px |

**@0 裁定（id 177）**：铅笔保持 14px 视觉（老板要的是「hover 时一个可编辑的图标提示」，inline 语义，不是 #002 那种头部独立控件，36px 验收针对后者），但 14×14 纯视觉点击目标对鼠标不友好 → @5 用 padding 把可点击区域扩到 ≥24×24（WCAG 2.5.8 AA 底线）。复测时**量 computed padding 后的点击盒，不只是可见 rect**。

素材：测试实例内已有员工「UI复现测试员 / 验证编辑」（#1），可直接用；0 号为内置 Assistant。

**现成探针**：`/tmp/verify-003.mjs`（CDP 9224）——自动设视口 → 合成 click 导航「员工」→ 选中第 N 个列表行 → 输出详情头/头像/info/输入框/按钮/铅笔的 rect 与 computed 值，含 `editTargets`（铅笔按钮 rect + computed padding + 图标盒）与 `hitAreas`（`elementFromPoint` 网格打点实测命中区，判定 ≥24×24 用这个数，不用可见 rect）；`--hover` 测铅笔显隐，`--edit` 测点击→输入→Enter 提交，`--shot` 存档。注意 `--edit` 会真实改名，**只对非 0 号员工用**。CDP 键盘教训照旧：`Input.dispatchKeyEvent` 必须带 `text` 字段。

## #004 标签筛选并入搜索栏（`004-chat-tag-filter-into-searchbar.md`）

| 验收 | 复测方法 | 通过判据 |
| --- | --- | --- |
| ① 独立筛选行移除 | CDP：`.imb-chat-search-stack` 计数（应 0）+ 新行容器（`.imb-chat-search-row` 或 trigger 的父容器）+ `.imb-pane-header` 高度 | 不再有纵向第二个整宽行；**头部 h 126 → 88**（蓝图硬断言；基线 126 见 issue「基线实测」节） |
| ② 能力完整保留 | 点 `.imb-chat-tag-filter .imb-ms-trigger` → 读 `.imb-ms-panel` 的 `.imb-ms-option` → 多选 2 个具体标签 | 多选生效（chips 累加）、`allowNoTag`「无标签」选项在列、与具体标签互斥（选「无标签」→ 具体 chips 清空）、options 来自 `tagOptions`；**语义是 AND**（同一对话必须带全部所选标签，`chats.ts:173-181`），不得悄悄改成 OR |
| ③ 生效条件可见 + 一键清除 | 选中后读 trigger 内 `.imb-ms-chip`；点 `.imb-ms-clear` | 栏内可见已选 chips；一键清回占位态「按标签筛选」，列表行数回到基线 |
| ④ 窄宽度可用 | 中栏 300px + 800×600 等窄视口 | 搜索框与触发器同一行不换行、不挤压；`scrollWidth > innerWidth` 为 false |
| ⑤ 无回归 | 行级 `.imb-chat-tag-select` 计数（**必须仍是 18**，基线值）+ 空态文案 + 搜索+筛选叠加 | 行级打标签一像素不动；空态仍走 `chatListEmptyMessage(isSearching, tagFilter.length)`；`tagFilterKey`/`paramsKey` 仍在 |
| ⑥ quiet 视觉 + 无 !important | 截图 + 遍历 `document.styleSheets` 中命中 `imb-chat-search|imb-chat-tag-filter|imb-chat-filter-row` 的规则 | 与 `.imb-searchbox` 同基线、发丝线；**`!important` 计数 0**（蓝图验收 ⑧） |
| ⑦ 几何对齐（蓝图预测，实测定） | `.imb-vlist` 的 y/h、触发器宽度与字号 | 基线 y=146 h=884 → 预测 y=108 h=922；触发器宽度实测（蓝图估 ~87px）、字号 `--imb-text-sm`(13px) 而非行级 11px——与 #003 铅笔 14px 同属「待验项」，实测后报 @0 定 |

红线：不得回退成 `040ae10` 的单选 chips 形态；不得改 `tagFilter` 的数组语义；`chat-module/index.tsx` 行级 TagSelect（`.imb-chat-tag-select`）一像素不许动；`spend-module` 的 `.imb-spend-tag-filter` 不碰。

**现成探针**：`/tmp/verify-004.mjs`（CDP 9224）——设视口 → 合成 click 导航「对话」→ 输出几何/计数/`!important` 审计；`--filter` 跑完整行为链（基线行数 → 开面板 → 多选 2 个具体标签 → 「无标签」互斥 → 一键清除回基线）；`--shot` 存档。CDP 教训照旧：导航必须合成 click、截图不要传 `fromSurface:false`、键盘事件带 `text` 字段。

**基线实测（2026-10-19，PID 572874，`fd52679` 运行态，#004 修复前；探针已冒烟通过，这些值就是 before/after 的 before）**：`.imb-pane-header` 299×126 @(76,20)、`.imb-pane-header-top` 283×48 @(84,20)、`.imb-chat-search-stack` 计数 1、`.imb-ms.imb-chat-tag-filter` 283×34 @(84,104)、SearchInput 183×26 @(121,71)（placeholder「搜索对话」/hint Ctrl+K）、tag trigger 283×34 @(84,104)（placeholder「按标签筛选」、字号 **15px**、min-height 34px、aria-expanded false）、`sameRow` false、`.imb-vlist` 299×884 @(76,146)、firstRowY 146、rowCount 18、**行级 `.imb-chat-tag-select` 18（红线基线）**、`.imb-chat-filter-row` 0、`.imb-spend-tag-filter` 0（未开统计模块）、`!important` 规则 0、overflowX false。修复后预期：searchStackCount 0、searchRow 出现、sameRow true、header h 88、vlist y=108 h=922、触发器宽度与字号待实测报 @0。

**探针实测教训（2026-10-19 冒烟跑通，全是探针坑不是应用坑；`--filter` 9/9 断言 PASS）**：
1. **多选面板选完不关**：点一次选项后面板仍开着（`aria-expanded` 仍 true），此时再点 trigger 是**关上**它 → 之后所有选项点击静默失效，表现为「每隔一次操作失效」。探针必须先读 `.imb-ms-panel` 是否存在，只在关闭时才点 trigger。
2. **标签筛选是 AND 不是 OR**（源码定论）：`src/main/db/chats.ts:173-181` `c.id IN (SELECT chat_id FROM chat_tags WHERE tag IN (?, ?) GROUP BY chat_id HAVING COUNT(DISTINCT tag) = ?)`，注释明写 "the chat must carry every requested tag"。所以选 2 个标签 = 同时带这两个标签的对话；当前种子数据下没有任何对话同时带「复测甲+复测乙」→ 2 标签筛选结果为 **0 行**，这是正确行为。
3. **列表是虚拟滚动**：`rowCount` 只是**渲染出来的行数**（53 个对话只渲染 18 行），不能当筛选总数用。判断筛选结果用「每一渲染行都带目标标签」+ 0 结果时的空态文案。
4. **0 结果态**：`.imb-vlist` 被替换为 `.imb-list-empty`，文案 `没有带这些标签的对话`（`chatListEmptyMessage(isSearching, tagCount)`，`src/renderer/components/modules/chat/chat-module/index.tsx:74-80`）。
5. **微应用模块常驻一条隐藏空态**：`.imb-miniapp-host.imb-is-hidden` 里也挂着一个 `.imb-list-empty`（文案「从侧边栏选择一个微应用」），`document.querySelector('.imb-list-empty')` 会先命中它 → 空态断言必须用 `.imb-chat-tag-filter` 的 `closest('.imb-pane')` 限定到对话中栏。
6. **实例是长命的**：上次跑留下的筛选状态会带到下一次（跑之前先点 `.imb-ms-clear` 复位，再测基线行数）。
7. **测试数据种子（2026-10-19）**：`~/.imboss-ui-test` 的 53 个对话中，复测甲×2（chat 50/52）、复测乙×2（chat 51/53）、无标签×49；没有对话同时带两个标签。筛选面板 options = [无标签, #复测乙, #复测甲]。

## 状态机更新规则

- 复测**全部通过** → issue 头部 `- **状态**:` 改 `fixed-verified`，处理记录追加一行（日期 / 复测 commit / 结果）。
- 有任一项不过 → 状态保持 `fixing`，在 issue 里「处理记录」写明**不过的是哪一条 + 实测值 + 截图名**，回报 @0 并 @ 对应修复人，不替对方改代码。
- 提交：只 `git add -N` + `git commit --only` 自己改的 issue 文件与新增证据；提交后三项自查——`git show --stat --format='' HEAD` 只有自己的文件、`git status --porcelain` 只剩别人的、`git diff --cached --stat` 为空或与操作前条数一致（老板 21 个暂存 WIP 已于 `3e5fcee` 提交，现常态为 0）。
