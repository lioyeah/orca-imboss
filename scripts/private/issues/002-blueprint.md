# 002-blueprint · 中栏标题右侧「+ 号」按钮 —— 参考实现蓝图

- **状态**: `blueprint`（参考实现，供 @4 实施；含 **1 个待决策点 D1**）
- **编制**: @1 构建验证（只做 `git show` 取证 + 测试实例只读测量；**未改动任何 `src/` 文件**，未触碰老板暂存区）
- **基线**: 分支 `mine`，HEAD `887e759`，工作区含老板 21 个暂存 WIP 文件（原样未动）
- **测试实例**: `scripts/private/run-test-env.sh`，`RUNNING PID 309391`，HOME `/home/ilio/.imboss-ui-test`，CDP `9224`，视口 1262×1030
- **关联 issue**: `scripts/private/issues/002-list-pane-plus-button.md`（`verified`）
- **上游锚点**: `040ae10`（`mine` 上的私有层提交，boss 说的「对话界面已有实现」就在它里面）

---

## 0. TL;DR

1. `040ae10` 的 `ListPane` 本来就有可选 `actions?: ReactNode` 插槽，chat-module 传了一个 `+` 图标按钮；**老板暂存 WIP 把这两处都删了**（`git diff --cached --stat`：`list-pane/index.tsx` 9 行、`chat-module/index.tsx` 22 行，均为净删除；`list-pane/index.css` 28 行），只留下底部整宽大按钮。
2. 修复 = 在当前（WIP 后）的 list-pane 结构上**重新加回 `actions` 插槽**，并把 `+` 按钮补回 chat 与 employees 两个模块。**4 个文件、全部在上游侧**（`src/renderer/components/**`），**不需要动私有层**，**不需要 `!important`**。
3. **重要事实纠正**：`040ae10` 里「+ 号」和「底部大按钮」是**并存**的，chat 那次是**纯粹新增**；且 `040ae10` 的搜索区已经是 SearchInput + TagSelect 纵向两行。所以「恢复 040ae10」≠「删底部按钮」——底部按钮去留是独立决策，见 **D1**。
4. `040ae10` 的 `.imb-pane-action-btn` 样式**整块在私有层 `overrides.css` 且带 11 处 `!important`**（30×30、radius 8px）。新实现把这 28px 尺寸放进上游 `list-pane/index.css`，其余外观（muted 色 / hover / focus ring / radius）上游 `.imb-icon-btn` 已经全部提供，**零 `!important`**。

---

## 1. `040ae10` 原始实现（`git show 040ae10:<path>` 提取）

### 1.1 `src/renderer/components/list-pane/index.tsx`（040ae10，全文 33 行）

```tsx
export interface ListPaneProps {      // 第 4-9 行
  actions?: ReactNode;                // ← 可选插槽，位于 title 之后、search 之前
  search?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}
...
      <div className="imb-pane-header">                        // 22
        <div className="imb-pane-header-top">                  // 23  ← 标题行容器
          <div className="imb-pane-title">{title}</div>       // 24
          {actions !== undefined && <div className="imb-pane-actions">{actions}</div>}  // 25
        </div>
        {search !== undefined && <div className="imb-pane-search-row">{search}</div>}   // 27
      <div className="imb-list">{children}</div>              // 29
      {footer !== undefined && <div className="imb-pane-footer">{footer}</div>}        // 30
```

### 1.2 `src/renderer/components/list-pane/index.css`（040ae10）

```css
.imb-pane-header { flex: none; display: flex; flex-direction: column; }
.imb-pane-header-top {
  height: var(--imb-header-h, 52px);      /* ← 依赖 --imb-header-h，该 token 已被 WIP 从私有层删除 */
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 var(--imb-space-4); box-sizing: border-box;
}
.imb-pane-title { font-size: var(--imb-text-lg, 16px); font-weight: 600;
  letter-spacing: -0.015em; color: var(--imb-fg); line-height: 1; }
.imb-pane-actions { display: flex; align-items: center; gap: var(--imb-space-2); }
.imb-pane-search-row { padding: 0 var(--imb-space-3) var(--imb-space-3); }
.imb-list { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }
.imb-pane-footer { flex: none; padding: var(--imb-space-3) var(--imb-space-4) var(--imb-space-4);
  border-top: 1px solid var(--imb-border); }
.imb-pane-footer .imb-btn { width: 100%; justify-content: center; }
```

### 1.3 chat-module 的 `+` 按钮 JSX（`040ae10:.../chat-module/index.tsx` 776-800）

```tsx
    <ListPane
      title={t("Chats")}
      actions={
        <Tooltip content={t("New Chat")} placement="bottom">
          <button
            type="button"
            className="imb-icon-btn imb-btn-ghost imb-pane-action-btn"
            aria-label={t("New Chat")}
            onClick={() => void newChat()}
          >
            <svg className="imb-icon" viewBox="0 0 16 16" fill="none"
                 stroke="currentColor" strokeWidth="1.6">
              <path d="M8 3v10M3 8h10" />        {/* 16 网格内联 plus */}
            </svg>
          </button>
        </Tooltip>
      }
      search={ /* imb-chat-search-stack 内 SearchInput + TagSelect，已是纵向两行 */ }
      footer={<Button block onClick={() => void newChat()}>{t("New Chat")}</Button>}   /* ← 底部大按钮当时仍在 */
    >
```

### 1.4 `040ae10` 私有层 `.imb-pane-action-btn`（`overrides.css:664-691`，**11 处 `!important`**）

```css
.imb-pane-action-btn { width: 30px !important; height: 30px !important;
  border-radius: 8px !important; display: grid !important; place-items: center !important;
  background: transparent !important; border: none !important;
  color: var(--imb-muted) !important; cursor: pointer !important; transition: …; }
.imb-pane-action-btn:hover { background: color-mix(in oklab, var(--imb-fg) 8%, transparent) !important; color: var(--imb-fg) !important; }
.imb-pane-action-btn:active { transform: scale(0.95); }
.imb-pane-search-row { padding: 0 12px 10px 12px !important; }
```

> 关键观察：这里面除了 **28/30px 盒尺寸 + radius + active scale**，其余（muted 色、hover 背景/前景、transition、focus ring、radius）**上游 `.imb-icon-btn` 已经全部提供**（`src/renderer/components/icon-button/index.css:1-29`）。所以新实现只需要一条尺寸规则，`!important` 一条都不需要。

---

## 2. 当前工作树结构差异（`040ae10` → 现在）

| 项 | `040ae10` | 当前工作树（HEAD `887e759` + 暂存 WIP） |
| --- | --- | --- |
| `ListPaneProps.actions` | 有（可选） | **无**（`src/renderer/components/list-pane/index.tsx:4-9` 只有 `title/search/children/footer`） |
| 标题行容器 | `.imb-pane-header-top`（flex 行，52px 固定高） | **无**；标题与 search 直接挂在 `.imb-pane-header`（`index.tsx:20-23`） |
| `.imb-pane-actions` | 有 | **无**（当前 `index.css` 无此规则） |
| `.imb-pane-search-row` | 有 | **无**；`{search}` 直接渲染（`index.tsx:22`） |
| `.imb-pane-header` | `flex:none; display:flex; flex-direction:column` | `padding: 0 var(--imb-space-2) var(--imb-space-2); flex:none`（`index.css:14-17`） |
| `.imb-pane-title` | `font-size: var(--imb-text-lg,16px)` + `letter-spacing:-0.015em` + `padding:0 16px` | `font-size: var(--imb-text-xl)` + `padding: 0 2px var(--imb-space-4)`（`index.css:19-23`，18px） |
| `--imb-header-h` / `--imb-titlebar-h` | 私有层覆盖：`--imb-titlebar-h: 24px`、`--imb-header-h: 52px`（`040ae10:private/theme.css:28-29`） | `--imb-header-h` **已消失**（当前 `src/` 0 命中）；`--imb-titlebar-h` **未消失**，但私有层 24px 覆盖被 WIP 删掉，现回落到上游 `src/renderer/styles/tokens.css:90` 的 **20px**（`.imb-pane { padding-top: var(--imb-titlebar-h) }` 仍生效，中栏比 040ae10 高 4px）。本次**不要**把 `--imb-header-h` 请回来，也不要写固定 52px 行高 |
| `.imb-pane-action-btn` | 私有层 `overrides.css:664`，30×30，11×`!important` | **0 命中**；当前 `private/overrides.css`（526 行）**无任何 pane-header 规则**（只有 `.imb-list-row` 311/316/332-333 等行样式） |
| chat-module `+` | 有 | 无（`index.tsx:776-800` 只有 `title/search/footer`） |
| employees-module `+` | 无（040ae10 也没有） | 无（`index.tsx:229-242`） |
| 底部大按钮 | chat 有 / employees 有 | chat 有（`chat-module/index.tsx:796-800`）/ employees 有（`employees-module/index.tsx:238-242`），`imb-btn imb-btn-primary imb-btn-block` 267×42 |

**当前两模块底部按钮实测**（@3 取证，视口 1262×1030、中栏 300px @ x=76）：
对话 `x=76 w=300 h=1030`，底部「新对话」`imb-btn imb-btn-primary imb-btn-block` 267×42，标题栏 `.imb-pane-actions` = `null`；员工同样，「招募」267×42。

---

## 3. 影响面：ListPane 全部 8 个消费者

| # | 调用点 | 传的 props | 是否需要改 |
| --- | --- | --- | --- |
| 1 | `src/renderer/components/modules/chat/chat-module/index.tsx:776` | `title` / `search`(SearchInput+TagSelect 纵向栈) / `footer` | **是**（补 `actions`） |
| 2 | `src/renderer/components/modules/employees/employees-module/index.tsx:229` | `title` / `search`(单个 SearchInput) / `footer` | **是**（补 `actions`） |
| 3 | `src/renderer/components/modules/settings/settings-module/index.tsx:67` | 仅 `title` | 否 |
| 4 | `src/renderer/components/modules/settings/settings-providers/index.tsx:121` | `title` / `footer` | 否 |
| 5 | `src/renderer/components/modules/settings/settings-mcp/index.tsx:156` | `title` / `search` / `footer` | 否 |
| 6 | `src/renderer/components/modules/settings/settings-skills/index.tsx:157` | `title` / `search` / `footer` | 否 |
| 7 | `src/renderer/components/modules/cron/cron-module/index.tsx:225` | `title` / `search` / `footer` | 否 |
| 8 | `src/renderer/components/modules/spend/spend-module/index.tsx:194` | `title` / `search` | 否 |

**类型层面零破坏**：全仓库 grep `<ListPane` 只有这 8 处；所有形似 `actions=` 的命中都属于 `Modal` / `ContextMenu` 的 prop（如 `chat-module/index.tsx:997`、`employees-module/index.tsx:329`），与 ListPane 无关。新增可选 prop 后，其余 6 个消费者不传即不渲染，`tsc` 无新增错误。

**另一个事实**：老板暂存 WIP **没有碰** `employees-module`（`git diff --cached` 里无此文件）——也就是说员工模块**从来就没有过** `+` 号（`040ae10` 也没有），本 issue 对它是「新增」而非「恢复」，与 chat 的「恢复」性质不同。

---

## 4. 决策点 D1（**@4 动手前必须找 @0 / 老板确认**）：底部整宽大按钮去留

两个信息源冲突，必须由人拍板：

- **证据 A（删）**：老板原话「新建对话 / 新招募员工**不应**在底部占一个巨大按钮，**只需**中栏右侧一个 + 号」；issue 002 验收标准 #1 明确写「底部整宽大按钮**移除**」。quiet 语言下 300px 中栏里 267×42 整宽主色按钮正是噪声源。
- **证据 B（留）**：`040ae10` 实际行为是「+ 与底部大按钮**并存**」（见 1.3），且 @0 明确备注「chat 那次是纯粹新增」。

**我的建议：按 D1=移除实现**（对齐老板原话与 issue 验收 #1），但把「保留底部」的差异压缩成**一行回退**（不删 `footer={…}` 块即可），并在 commit message 里写明该决策待确认。
无论 D1 取哪值，`actions` 插槽与 `+` 按钮的 diff 完全相同。

---

## 5. 推荐最小 diff（4 个文件，全部上游侧）

> 纪律：只加行 / 改必要行，**不重排、不 reformat 上游文件**；保持现有 2 空格缩进与既有 import 字典序。

### 5.1 `src/renderer/components/list-pane/index.tsx`

```diff
 export interface ListPaneProps {
   title: string;
+  actions?: ReactNode;
   search?: ReactNode;
   children: ReactNode;
   footer?: ReactNode;
 }
```
```diff
       <div className="imb-pane-header">
+        <div className="imb-pane-header-top">
           <div className="imb-pane-title">{title}</div>
+          {actions !== undefined && <div className="imb-pane-actions">{actions}</div>}
+        </div>
         {search}
       </div>
```
（注意：当前 `{search}` 是无条件渲染，`040ae10` 的 `search !== undefined &&` 守卫不必引入——保持现状最小改动。）

### 5.2 `src/renderer/components/list-pane/index.css`（在 `.imb-pane-header` 之后新增 3 条规则，并微调 `.imb-pane-title`）

```diff
 .imb-pane-header {
   padding: 0 var(--imb-space-2) var(--imb-space-2);
   flex: none;
 }
 
+.imb-pane-header-top {
+  display: flex;
+  align-items: center;
+  justify-content: space-between;
+  gap: var(--imb-space-2);
+  min-width: 0;
+  padding-bottom: var(--imb-space-4);
+}
+
 .imb-pane-title {
   font-size: var(--imb-text-xl);
   font-weight: 600;
-  padding: 0 2px var(--imb-space-4);
+  min-width: 0;
+  padding: 0 2px;
+  overflow: hidden;
+  text-overflow: ellipsis;
+  white-space: nowrap;
+}
+
+.imb-pane-actions {
+  display: flex;
+  align-items: center;
+  gap: var(--imb-space-2);
+  flex: none;
+}
+
+/* .imb-icon-btn 本身没有内在尺寸（见 icon-button/index.css:1-15），
+   所以显式给盒尺寸。28px 与私有层 --imb-private-h-control-sm 同值，
+   但上游 CSS 不引用私有 token；radius/hover/focus 由 .imb-icon-btn 与
+   var(--imb-radius-md)（私有层 theme.css:74 覆盖为 10px）自动获得。 */
+.imb-pane-action-btn {
+  width: 28px;
+  height: 28px;
+}
```

**几何不变式**：改前标题块 = 18px 行高盒 + 16px `space-4` 下内边距 ≈ 38px；改后 `.imb-pane-header-top` = 同样 38px（16px 移到行的 `padding-bottom`）。总高度不变，但 `+` 按钮改为与标题文字光学居中（而不是落在含 16px padding 的 38px 盒中心、偏低 8px）。
`.imb-pane-title` 的 ellipsis 三件套是**可选项**：300px 窄栏下防止长标题（如「Scheduled tasks」）换行把搜索框顶下去；若 @4 想更保守可只加 `min-width: 0`。

### 5.3 `src/renderer/components/modules/chat/chat-module/index.tsx`

新增 import（放在 `import { Input } from "../../../input";` 之前，即第 31 行前，保持字典序）：
```diff
+import { IconPlus } from "../../../icons";
 import { Input } from "../../../input";
```
在 ListPane 的 `title` 与 `search` 之间插入 `actions`（`index.tsx:776-778` 区域）：
```diff
     <ListPane
       title={t("Chats")}
+      actions={
+        <Tooltip content={t("New Chat")} placement="bottom">
+          <button
+            type="button"
+            className="imb-icon-btn imb-pane-action-btn"
+            aria-label={t("New Chat")}
+            onClick={() => void newChat()}
+          >
+            <IconPlus width={16} height={16} />
+          </button>
+        </Tooltip>
+      }
       search={
```
`Tooltip` 已在第 39 行 import，无需新增。**i18n 复用现成 key `New Chat`**（底部按钮同 key），不新增文案。

### 5.4 `src/renderer/components/modules/employees/employees-module/index.tsx`

新增两个 import（`icons` 放第 21 行 `import { ItemList }` 前；`tooltip` 放第 27 行 `import { SearchInput }` 后，均保持字典序）：
```diff
+import { IconPlus } from "../../../icons";
 import { ItemList } from "../../../item-list";
 ...
 import { SearchInput } from "../../../search-input";
+import { Tooltip } from "../../../tooltip";
```
插入 `actions`（`index.tsx:229-231` 区域）：
```diff
     <ListPane
       title={t("Employees")}
+      actions={
+        <Tooltip content={t("Recruit")} placement="bottom">
+          <button
+            type="button"
+            className="imb-icon-btn imb-pane-action-btn"
+            aria-label={t("Recruit")}
+            onClick={() => setRecruitOpen(true)}
+          >
+            <IconPlus width={16} height={16} />
+          </button>
+        </Tooltip>
+      }
       search={
```
行为等价于原底部「招募」按钮（`setRecruitOpen(true)`，`recruitOpen` state 在 `index.tsx:37`，Modal 在 `index.tsx:347-348`）。i18n 复用现成 key `Recruit`（`index.tsx:240` 同 key）。

### 5.5 与 `040ae10` 的 3 处有意偏差（都在为「少一条私有层规则」服务）

1. **去掉 `imb-btn-ghost`**：它是 `Button` 组件的类（`src/renderer/components/button/index.css:67-71`：`padding-inline: 8px; color: var(--imb-fg)`），混在裸 `button.imb-icon-btn` 上会与 `padding: 0`（`icon-button/index.css:10`）互相打架，且 040ae10 靠私有层 `!important` 才压住。新实现不加。
2. **用共享 `IconPlus` 取代 16 网格内联 SVG**：`src/renderer/components/icons/index.tsx:137`（24 网格、`strokeWidth={2}`、`x1=12 y1=5 x2=12 y2=19` / `x1=5 y1=12 x2=19 y2=12`），传 `width={16} height={16}` 与 040ae10 的 16px 盒视觉近似（笔画跨度 14/24 vs 10/16，略小一点点，可接受）。好处：与全仓库图标体系一致、少一份重复 SVG。
3. **不用 `IconButton` 组件**（`src/renderer/components/icon-button/index.tsx`）：它会同时写 `aria-label` 和 `title={label}`，与 `Tooltip` 气泡重复；且盒子被硬编码为 `style={{width: boxSize, height: boxSize}}`（默认 32），还要反着用。全仓库目前 0 个 `<IconButton` 使用点，勿引入。

### 5.6 为什么不动私有层

- AGENTS.md 修理阶梯：**能 token 就不选择器，能私有层就不动上游**——但这里反过来更优：`040ae10` 之所以把 `.imb-pane-action-btn` 塞进私有层，是因为那个提交在私有分支上写新样式最省事；结果是 11 处 `!important` + 私有层与上游 `.imb-icon-btn` 抢权重。放到上游 `list-pane/index.css` 后：`!important` 0 处、私有层 0 改动、且 radius 通过 `var(--imb-radius-md)`（私有层 `theme.css:74` 已覆盖为 10px）**自动**获得私有外观——这正是「上游 token 被私有层覆盖」的正向用法。
- 私有层当前**没有任何 pane-header 规则**（`private/overrides.css` 只有 `.imb-list-row` 311/316/332-333），不存在需要绕开的既有覆盖。

---

## 6. 验收 checklist

**构建**
- [ ] `pnpm run typecheck`（node + web）全绿，0 error
- [ ] `pnpm run build` exit 0
- [ ] 构建在**真实 HOME** 下执行（pnpm 是 mise shim，foreign HOME 下不可用）；隔离只发生在启动层（`HOME=~/.imboss-ui-test`）

**视觉（测试实例，视口 1262×1030，中栏 300px）**
- [ ] 对话 / 员工两个模块标题**右侧**出现 `+` 图标按钮，与标题文字光学居中，约 28×28
- [ ] 300px 窄宽下标题不换行、搜索框不被顶下去（ellipsis 生效）
- [ ] radius 呈 10px（私有层 `--imb-radius-md` 自动继承），muted 色 / hover 变色与其它图标按钮一致
- [ ] 底部按钮按 **D1** 决策处理（若删：`.imb-pane-footer` 从两模块消失，`.imb-list` 直接到底）
- [ ] 其余 6 个 ListPane 使用者无视觉回归、无新增空白行

**交互 / 可达性**
- [ ] 点 `+` → 对话：`newChat()`；员工：招募弹窗打开
- [ ] `Tooltip` 从下方弹出，文案 = `New Chat` / `Recruit`（复用现成 key，无新文案）
- [ ] `aria-label` 存在；Tab 可聚焦（原生 `<button>` 天然可聚焦），Enter/Space 可触发
- [ ] focus-visible 有 `--imb-focus-ring`

**结构红线（@1 会复检）**
- [ ] `src/renderer/private/` **零改动**（本 issue 不需要）
- [ ] 新增代码 **0 处 `!important`**；未触碰 `--imb-accent` 及任何 accent token
- [ ] 上游文件只加必要行，无 reformat / 无批量缩进变化（`git diff` 应干净可读）
- [ ] `src/renderer/main.tsx` 的 `import "./private";` 仍是最后一个 import
- [ ] 若在 `feat/*` 分支上做：不得 import `src/renderer/private/`
- [ ] 提交纪律：`git add -N <file> && git commit --only <file>`；**绝不** `git add -A` / 裸 `git commit` / stash / checkout / rebase；老板 21 个暂存文件保持原样

---

## 7. 截图 / 测量步骤（测试实例，只读 + 轻点导航）

```bash
cd "/workshop/Github repos/ai-assistant-dev/orca-imboss"

# 0) 确认实例（预期 RUNNING；若未运行先 scripts/private/run-test-env.sh）
./scripts/private/run-test-env.sh --status

# 1) 切到「对话」模块（nav item 是 button.imb-nav-item；已实测 aria-label/text 均为中文：
#    对话 / 员工 / 定时任务 / 统计 / 图谱 / UI 验证探针 / 设置）
node scripts/private/cdp-eval.mjs --eval "([...document.querySelectorAll('.imb-nav-item')].find(b => (b.textContent||'').includes('对话'))||{click(){}}).click()"

# 2) 量标题行 / + 号 / 搜索区 / 底部按钮（修复前 .imb-pane-actions 与 .imb-pane-action-btn 均为 null）
node scripts/private/cdp-eval.mjs --eval "(() => { const q = s => document.querySelector(s); const b = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; }; const cs = e => e ? getComputedStyle(e) : null; return JSON.stringify({ header: b(q('.imb-pane-header')), headerTop: b(q('.imb-pane-header-top')), title: b(q('.imb-pane-title')), titleFont: cs(q('.imb-pane-title'))?.fontSize, actions: b(q('.imb-pane-actions')), plus: b(q('.imb-pane-action-btn')), search: b(q('.imb-chat-search-stack')), list: b(q('.imb-list')), footer: b(q('.imb-pane-footer')), footerBtn: b(q('.imb-pane-footer .imb-btn')), pane: b(q('.imb-listpane')) }); })()"

# 3) 截图留证（写到 scripts/private/issues/evidence/ 下，勿覆盖 @3 的 002-*.png）
node scripts/private/cdp-eval.mjs --shot scripts/private/issues/evidence/002-blueprint-chat-after.png

# 4) 员工模块：把第 1 步的 '对话' 换成 '员工'，再跑 2、3
```

> 导航标签在测试实例里是中文（`t()` 中文环境），所以用 `textContent.includes('对话')` 这种精确匹配最稳；若实例语言变了，先用
> `node scripts/private/cdp-eval.mjs --eval "JSON.stringify([...document.querySelectorAll('.imb-nav-item')].map(b => b.textContent))"`
> 看一眼真实标签再改选择器。

> 注意：编制时（2026-10-19）实例停在 @3 的「UI 验证探针」模块，nav 折叠、shell 为 `imb-shell-content imb-layout-single`，只有一个 `.imb-contentpane`，**没有 list pane 渲染**（`.imb-pane-header` 等全为 `null`）——所以第 1 步的导航点击是必需的，否则量不到东西。测量过程中不要 `--dpr` 改动老板实例；本实例 PID 309391 与 `~/.imboss` mtime 基线在 `--status` 里并排可见，操作前后各看一次即可。

---

## 8. 附：本次取证用到的只读命令（复现用）

```bash
git show 040ae10:src/renderer/components/list-pane/index.tsx
git show 040ae10:src/renderer/components/list-pane/index.css
git show 040ae10:src/renderer/components/modules/chat/chat-module/index.tsx | sed -n '774,830p'
git show 040ae10:src/renderer/private/overrides.css | sed -n '660,692p'
git diff --cached --stat -- src/renderer/components/list-pane src/renderer/components/modules/chat
grep -rn "<ListPane" src/renderer --include=*.tsx
```
