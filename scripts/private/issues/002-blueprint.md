# Issue #002 蓝图：中间栏底部大按钮 → 标题行紧凑图标按钮

> 状态：**已有一份完整实现，就在工作区里，但未暂存、未提交。**
> 本文档分三部分：① 040ae10 原始实现提取；② 当前工作区实现（即真正会落地的版本）；③ 实测验证 + 复检清单 + 收尾动作。
> 本文档只读代码 + 只写本文件，未触碰 `src/`、未触碰暂存区。

## TL;DR

- issue #002 要求把中间栏底部的「新建对话 / 招募」大 Button 改成标题行右侧的 32×32 图标按钮。
- 老板暂存 WIP 已包含 #001 的修复；**#002 的修复目前只以未暂存改动存在于工作区**（`git diff --stat` 见下），已构建（`out/renderer/assets/index-C1scJDwf.css` + `index-CsI-QzR8.js`）并在测试实例（PID 487264，07:46:29 启动）里跑起来。
- 决策 D1（底部大按钮是否删除）**在工作区实现里已被裁定为「删除」**：chat 与 employees 两个模块的 footer 大 Button 都被移除，实测 `.imb-pane-footer` 为 null、`.imb-listpane` 内 0 个 `.imb-btn-primary`。
- ⚠️ **未暂存 = 脆弱**：任何 `git stash` / `git checkout --` / 切分支都会静默丢掉这份修复。建议老板尽快 `git add -N <4 个文件> && git commit --only <4 个文件>`。

---

## 1. 040ae10 原始实现提取（老板的暂存 WIP 版本）

`git show 040ae10:<path>`，对应任务：issue #002 的「参考实现」。

### 1.1 040ae10 `src/renderer/components/list-pane/index.tsx`（33 行）

```tsx
type ListPaneProps = {
  actions?: React.ReactNode;
  search?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
};
```

header 结构：

```tsx
<div className="imb-pane-header">
  <div className="imb-pane-header-top">
    <div className="imb-pane-title">{title}</div>
    {actions !== undefined && <div className="imb-pane-actions">{actions}</div>}
  </div>
  {search !== undefined && <div className="imb-pane-search-row">{search}</div>}
</div>
```

### 1.2 040ae10 `src/renderer/components/list-pane/index.css`

```css
.imb-pane-header-top {
  height: var(--imb-header-h, 52px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--imb-space-4);
}
.imb-pane-title {
  font-size: var(--imb-text-lg, 16px);
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--imb-fg);
  line-height: 1;
}
.imb-pane-actions {
  display: flex;
  align-items: center;
  gap: var(--imb-space-2);
}
.imb-pane-search-row {
  padding: 0 var(--imb-space-3) var(--imb-space-3);
}
```

### 1.3 040ae10 `chat-module/index.tsx:776-800`（+ 与底部大按钮并存）

```tsx
<Tooltip content={t("New Chat")} placement="bottom">
  <button
    type="button"
    className="imb-icon-btn imb-btn-ghost imb-pane-action-btn"
    aria-label={t("New Chat")}
    onClick={() => void newChat()}
  >
    <svg className="imb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 3v10M3 8h10" />
    </svg>
  </button>
</Tooltip>
```

> 注意：040ae10 里 **底部大 Button 仍然存在**（+ 与大按钮并存），所以 D1 在 040ae10 里没有答案。

### 1.4 040ae10 `src/renderer/private/overrides.css:664-691`

```css
.imb-pane-action-btn { /* 11 条 !important，30x30 / radius 8px / grid place-items */ }
.imb-pane-search-row { padding: ... !important; }
```

### 1.5 040ae10 私有层对 #001 的连带（背景）

私有 `overrides.css` 有一条 `.imb-shell-content { grid-template-columns: 310px 1fr !important }`，把 graph/miniapp 的单栏版面挤进 310px 列里 → 这就是 issue #001 的根因；老板的暂存 WIP 把这条 override 删掉了。`.imb-pane-action-btn` 的 `!important` 那批也同属这批私有 override。当前工作树 `src/renderer/private/overrides.css`（526 行）里**没有任何 pane-header 规则**。

---

## 2. 当前工作树结构（040ae10 之后的基线）

040ae10 的 list-pane 改动在当前树里**不存在**（被后续重构洗掉了）：当前 `list-pane/index.tsx` 只有 `title/search/children/footer` 四个 props，header 是：

```tsx
<div className="imb-pane-header">
  <div className="imb-pane-title">{title}</div>
  {search}
</div>
```

`list-pane/index.css` 现状：

```css
.imb-pane-header {
  padding: 0 var(--imb-space-2) var(--imb-space-2);
  flex: none;
}
.imb-pane-title {
  font-size: var(--imb-text-xl);
  font-weight: 600;
  padding: 0 2px var(--imb-space-4);
}
```

没有 `.imb-pane-header-top` / `.imb-pane-actions` / `.imb-pane-search-row`。

### token 事实（写 CSS 时容易踩的坑）

- `--imb-header-h` **已不存在**（`src/` 0 命中；只在 040ae10 的 `private/theme.css:28-29` 出现过）。能用的只有 `--imb-titlebar-h`（`src/renderer/styles/tokens.css:90`，上游 20px）。
- 上游 `src/renderer/styles/tokens.css`：`--imb-space-2: 8px`、`--imb-space-3: 12px`、`--imb-space-4: 16px`、`--imb-radius-sm: 4px`、`--imb-radius-md: 8px`、`--imb-text-lg: 16px`、`--imb-text-xl: 18px`。
- 私有层 `src/renderer/private/theme.css`：`--imb-radius-sm: 6px`（:73）、`--imb-radius-md: 10px`（:74）、私有节奏 token `--imb-private-h-row: 36px` / `--imb-private-h-control: 36px` / `--imb-private-h-control-sm: 28px`（:97-99）。
- **`src/renderer/components/icon-button/index.css`（定义 `.imb-icon-btn` 的盒模型/颜色/hover/focus）不在 bundle 里**——全仓 `src/renderer` 没有任何地方 import `icon-button`，`IconButton` 组件是死代码（0 引用）。构建产物 `out/renderer/assets/*.css` 里 `.imb-icon-btn` 只有私有层的按压规则（`private/overrides.css:244` transition、`:253 :active transform scale(0.94)`）。所以裸写 `<button className="imb-icon-btn ...">` 拿不到任何基础样式，**按钮必须自包含**（这也是工作区实现的写法）。

### ListPane 全部消费者（8 处，加 `actions?:` 是类型级非破坏性改动）

```
src/renderer/components/modules/chat/chat-module/index.tsx:776
src/renderer/components/modules/employees/employees-module/index.tsx:229
src/renderer/components/settings/settings-module/index.tsx:67
src/renderer/components/settings/settings-providers/index.tsx:121
src/renderer/components/settings/settings-mcp/index.tsx:156
src/renderer/components/settings/settings-skills/index.tsx:157
src/renderer/components/modules/cron/cron-module/index.tsx:225
src/renderer/components/modules/spend/spend-module/index.tsx:194
```

其余 `actions=` 命中都属于 `Modal` / `ContextMenu` 的 props，与本任务无关。

> chat 是「恢复」040ae10 已有的 +；employees 是**新增**（040ae10 也没有 employees 的 +，老板暂存 WIP 未触碰 employees-module）。这两个语义不同，写 commit message 时最好分开说。

---

## 3. 工作区现有实现（真实会落地的版本，未暂存）

`git status --short`：

```
MM src/renderer/components/list-pane/index.css
MM src/renderer/components/list-pane/index.tsx
MM src/renderer/components/modules/chat/chat-module/index.tsx
 M src/renderer/components/modules/employees/employees-module/index.tsx
```

改动形态（对照 040ae10 的差异）：

| 项 | 040ae10 | 工作区实现 |
|---|---|---|
| `actions` prop | 有（顺序 actions/search/children/footer） | 有（同序） |
| header 结构 | `.imb-pane-header-top` + `.imb-pane-search-row` | `.imb-pane-header-top`，search 不再包 `.imb-pane-search-row` |
| `.imb-pane-action-btn` | 私有层 11 条 `!important` | **上游自包含**，0 条 `!important`，32×32，`--imb-radius-md` |
| 标题 font-size | `var(--imb-text-lg, 16px)` | 保持当前 `var(--imb-text-xl)` |
| `+` 图标 | 040ae10 内联 16-grid `<svg>` | 复用 `IconPlus`（`src/renderer/components/icons/index.tsx:137`，24-grid）+ `className="imb-icon imb-sm"` |
| D1 底部大按钮 | 保留 | **删除**（chat + employees 都是） |
| employees `+` | 无 | 新增 |

实现要点：

- `list-pane/index.tsx`：加 `actions?: React.ReactNode`；header 变成 `.imb-pane-header > .imb-pane-header-top > (.imb-pane-title + .imb-pane-actions)`，`{search}` 直接跟在 `.imb-pane-header-top` 后面（没有 `.imb-pane-search-row` 这一层）。
- `list-pane/index.css`：新增 `.imb-pane-header-top` / `.imb-pane-actions` / `.imb-pane-action-btn`；`.imb-pane-title` 原来的 `padding-bottom: var(--imb-space-4)` 移到 `.imb-pane-header-top` 上（几何中性：标题行与原来等高，按钮视觉居左于标题中心线）。
- `.imb-pane-action-btn` 自包含样式：`display: inline-flex; align-items/justify-content: center; width/height: 32px; padding: 0; border: none; border-radius: var(--imb-radius-md); background: transparent; color: var(--imb-muted); cursor: pointer; flex: none;` + `:hover { background: var(--imb-fg-soft); color: var(--imb-fg) }` + `:focus-visible`；CSS 里有注释解释为什么必须自包含（`.imb-icon-btn` 基础样式表随 `IconButton` 组件走，而它不在 bundle 里）。复用类名 `imb-icon-btn` 的收益仍在：私有层 `private/overrides.css:253` 的 `.imb-icon-btn:active` 按压反馈对它生效。
- `chat-module/index.tsx`：`import { IconPlus } from "../../../icons"`；header 里加 `actions={<Tooltip ...><button className="imb-icon-btn imb-pane-action-btn" aria-label={t("New Chat")} ...><IconPlus className="imb-icon imb-sm" /></button></Tooltip>}`；删除 footer 大 Button。
- `employees-module/index.tsx`：同样加 `IconPlus`（另加 `import { Tooltip } from "../../../tooltip"`），`aria-label` 为招募；删除 footer 大 Button。
- **没有用 `IconButton` 组件**（会自带 title + aria-label，双重无障碍播报）；**没有用 `imb-btn-ghost`**（那是 `Button` 组件的类，本按钮不是 `Button`）。

### 为什么不采用我原先建议的 28px 版

原建议照抄 040ae10 的 30px、并单独写 `.imb-pane-action-btn { width/height: 28px }`。工作区实现用 32px，理由更实在：`--imb-private-h-control-sm` 本来就是 28px，但搜索输入框实测 26px 高、TagSelect 34px，32×32 与 34px 行高更协调，且 32 是私有层里 `--imb-private-h-control` 的同级控件高度。**结论：32px 优于 28px，按工作区实现走。**

---

## 4. 实测验证（测试实例 PID 487264，CDP 9224，视口 1262×1030，dpr 1，窗 1362×1067）

中间栏宽 300px（x=76…376），标题行 `.imb-pane-header-top` 283×48（x=84，y=20）。

### 对话模块（chat-module）

| 项 | 实测 |
|---|---|
| `.imb-pane-header` | 299×126 @ x=76,y=20 |
| `.imb-pane-header-top` | 283×48 |
| `.imb-pane-title` | 40×29 @ x=84,y=22，`font-size: 18px` |
| `.imb-pane-actions` | 32×32 @ x=335,y=20 |
| `.imb-pane-action-btn` | 32×32，`border-radius: 10px`，`color: rgb(110,117,115)`（muted），`background: rgba(0,0,0,0)`，`display: flex`，内嵌 svg 16px |
| `aria-label` | `新对话` |
| `.imb-chat-search-stack` | 283×70（SearchInput 183×26 + `.imb-chat-tag-filter` 283×34） |
| `.imb-pane-footer` | **null** |
| `.imb-listpane .imb-btn-primary` | **0 个**（底部大按钮已消失） |
| `.imb-list` | 299×884，首行「新新对话」 |

### 员工模块（employees-module）

| 项 | 实测 |
|---|---|
| `.imb-pane-header-top` | 283×48 |
| `.imb-pane-actions` / `.imb-pane-action-btn` | 32×32 @ x=335，`border-radius: 10px` |
| `aria-label` | `招募` |
| 搜索输入 | 233×26 @ x=121 |
| `.imb-pane-footer` / footer 按钮 | null / null |
| `.imb-listpane .imb-btn-primary` | 0 个 |
| 首行 | `Assistant#0Assistant` |

### 其他模块（未回归）

settings（通用/常用项目/主题）、cron、spend 三个模块没加 `actions`，保持原样；`settings-module` / `settings-providers` / `settings-mcp` / `settings-skills` 同。本次未逐一打开验证，属**未覆盖项**（见清单）。

---

## 5. 复检清单（给 @3 或任何人复测用）

1. 构建：`pnpm run typecheck && pnpm run build`（在真实 HOME 下跑；`pnpm` 是 mise shim，换 HOME 会报 `mise ERROR pnpm is not a valid shim`）。
2. 启动隔离实例：`bash scripts/private/run-test-env.sh`（PID/端口：`~/.imboss-ui-test/imboss-test.pid`，CDP `http://127.0.0.1:9224`）。**严禁**碰老板实例（AppImage PID ~261970，数据根 `~/.imboss`，user-data-dir `~/.config/orca-imboss`）。
3. 导航到对话/员工（nav 是 `button.imb-nav-item`，合成 `.click()` 后 React **异步 flush**，读 DOM 前等 600–900ms；本会话实测 `Enter` 键同样可触发）。
4. 断言：`.imb-pane-action-btn` 存在且 32×32；`aria-label` 分别为 `新对话` / `招募`；`.imb-pane-footer` 为 null；`.imb-listpane` 内无 `.imb-btn-primary`。
5. 交互：hover 背景变 `--imb-fg-soft`、`:active` 有 `scale(0.94)` 按压；`Tab` 聚焦有 `:focus-visible` outline。
6. 点击 `+` 真的新建（对话模块应出现新行并进入该会话；员工模块应弹出招募表单）。
7. 回归：settings / cron / spend 三个模块的 ListPane 仍正常（它们没传 `actions`）。
8. 回归 #001：graph 模块单栏版面应铺满内容区（`.imb-graph-stage` 实测 1054×877 @ 1262×1030，之前被 310px 列挤小的 bug 已修）。
9. 结构规则：`--imb-private-layer` 仍为 1；`--imb-accent` 及 accent token 无新增 `!important`；`src/renderer/main.tsx` 里 `import "./private";` 仍是最后一条；feat/* 分支不得 import `src/renderer/private/`。

### 测量 / 截图配方

```bash
cd "/workshop/Github repos/ai-assistant-dev/orca-imboss"
node scripts/private/cdp-eval.mjs --eval '<js>'
node scripts/private/cdp-eval.mjs --shot /tmp/chat.png
node scripts/private/cdp-eval.mjs --dpr 2   # 需要时再切回 1
```

## 6. 收尾动作（需要老板/大总管决定）

1. **立即提交这 4 个文件**（未暂存改动随时可能被 `stash`/`checkout` 抹掉）：
   `git add -N src/renderer/components/list-pane/index.css src/renderer/components/list-pane/index.tsx src/renderer/components/modules/chat/chat-module/index.tsx src/renderer/components/modules/employees/employees-module/index.tsx && git commit --only <同样 4 个路径>`（`git add -N` 后必须立刻 commit，且只 commit 这几个路径；老板暂存的 21 个文件不能动）。
2. 确认 D1：删除底部大按钮是否符合预期（issue #002 的验收标准说「去掉」，040ae10 是保留的）。
3. 决定这份修复是先进 `mine` 私有分支，还是要整理成可上游 PR 的形态（若是后者，`.imb-pane-action-btn` 的自包含样式 + 无 `!important` 的写法正好适合上游；`IconPlus` 复用也是上游友好写法）。
4. employees 的 `+` 是纯新增，与 chat 的「恢复」语义不同，commit message 建议分开表述。
