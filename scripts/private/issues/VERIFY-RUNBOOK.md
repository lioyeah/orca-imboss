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
| ① 独立筛选行移除 | CDP：`.imb-chat-search-stack` 子元素数量与高度 | 不再出现第二个整宽行；头部高度显著低于 123px |
| ② 能力完整保留 | 打开筛选入口，多选 2 个标签 + 「无标签」选项 | 多选生效、`allowNoTag` 可用、options 来自 `tagOptions` |
| ③ 生效条件可见 + 一键清除 | 选中后读栏内显示；点清除 | 栏内可见已选（数量或 chips）；一键清回占位态 |
| ④ 窄宽度可用 | 中栏 300px | 搜索框可输入，筛选入口可点 |
| ⑤ 无回归 | 空态文案、搜索+筛选叠加、ListRow 行级 `TagSelect`（`.imb-chat-tag-select`） | 空态仍走 `chatListEmptyMessage(isSearching, tagFilter.length)`；行级打标签不受影响 |
| ⑥ quiet 视觉 | 截图 | 与 `.imb-searchbox` 同基线、发丝线、36px 级 |

红线：不得回退成 `040ae10` 的单选 chips 形态；不得改 `tagFilter` 的数组语义。

## 状态机更新规则

- 复测**全部通过** → issue 头部 `- **状态**:` 改 `fixed-verified`，处理记录追加一行（日期 / 复测 commit / 结果）。
- 有任一项不过 → 状态保持 `fixing`，在 issue 里「处理记录」写明**不过的是哪一条 + 实测值 + 截图名**，回报 @0 并 @ 对应修复人，不替对方改代码。
- 提交：只 `git add -N` + `git commit --only` 自己改的 issue 文件与新增证据；提交后自查 `git diff --cached --name-only | wc -l` 应回到 21（老板的 WIP 条数）。
