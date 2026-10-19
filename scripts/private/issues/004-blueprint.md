# Issue #004 蓝图：标签筛选并入搜索栏（去掉独立的第二行筛选控件）

> 状态：**待实现**（本文是给 @5 的 turnkey 参考实现；issue 文档 `004-chat-tag-filter-into-searchbar.md` 状态 `verified`）。
> 本文只读代码 + 只写本文件。所有行号为 2026-10-19 08:10 对 **HEAD `c0c5bf3`（含 #002 修复 `9aaf0a9`）** 复验的结果；拿不准的标「待验」。

## TL;DR

- 现状：对话中栏头部占**两行**——`chat-module/index.tsx:791-808` 的 `search` 插槽里，`.imb-chat-search-stack` 纵向堆叠 `SearchInput` + `TagSelect` 两个整宽控件，头部总高 **126px**。
- 目标：**一行**。把 `TagSelect` 的触发器改成搜索栏右侧的紧凑内联控件，头部降到 **88px**——与员工模块头部（今天实测 88px）完全持平，列表多出 38px 可见区。
- 推荐方案 **PP1**：JSX 只改**一个词**（`imb-chat-search-stack` → `imb-chat-search-row`），其余全是 `chat-module/index.css` 的替换；`TagSelect` / `MultiSelect` / `SearchInput` **一个字符都不改**，因此多选、`allowNoTag` 互斥、面板、键盘导航、点击外部关闭、一键清除全部原样继承。
- 已否决 **PP3**（Popover 包 TagSelect）：嵌套 portal 会让点击选项直接失效，机制见第 4.3 节——这是本 issue 最大的坑，@5 别踩。
- 行为链路零改动：`tagFilter` 数组、`serverMode`、`tagFilterKey`、`chatListEmptyMessage`、行级 `TagSelect`（`.imb-chat-tag-select`）全部不碰。

---

## 1. 现状（已复验，带行号）

### 1.1 JSX：`src/renderer/components/modules/chat/chat-module/index.tsx:791-808`

```tsx
      search={
        <div className="imb-chat-search-stack">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("Search chats")}
            hint={IS_MAC ? "⌘K" : "Ctrl+K"}
          />
          <TagSelect
            className="imb-chat-tag-filter"
            value={tagFilter}
            options={tagOptions}
            allowNoTag
            placeholder={t("Filter by tags")}
            onChange={setTagFilter}
          />
        </div>
      }
```

`ListPane` 把 `search` **直接**渲染在 `.imb-pane-header` 里、`.imb-pane-header-top` 之后，自己不包任何行容器（`src/renderer/components/list-pane/index.tsx:20-33`）：

```tsx
<div className="imb-pane-header">
  <div className="imb-pane-header-top">…title + actions…</div>
  {search}
</div>
```

所以「一行还是两行」完全由 chat-module 自己的这个 div 决定。

### 1.2 CSS：`src/renderer/components/modules/chat/chat-module/index.css:77-96`

```css
/* Search box + tag filter stacked in the pane header (filter directly under
   the search box, above the list). */
.imb-chat-search-stack {
  display: flex;
  flex-direction: column;
  gap: var(--imb-space-1);
}

/* The tag filter mirrors the search box's box + height so the two read as a
   matching pair. */
.imb-chat-tag-filter {
  width: 100%;
}

.imb-chat-tag-filter .imb-ms-trigger {
  min-height: 34px;
  padding: 2px 12px;
  background: var(--imb-bg);
}
```

> `.imb-chat-filter-row`（040ae10 时代的单选 chips 行）在当前树里**已不存在**（`src/` 全仓 0 命中），不要去找它、更不要把它加回来。

### 1.3 必须保持不变的链路（验收 #3/#5）

| 项 | 位置 | 说明 |
| --- | --- | --- |
| `tagFilter` 状态 | `chat-module/index.tsx:119` `useState<string[]>([])` | **多选数组**，不许改单选 |
| `serverMode` | `:193` `isSearching \|\| tagFilter.length > 0` | 决定走搜索接口还是本地列表 |
| `noTagFilter` / `concreteTags` | `:196-197` | 「无标签」伪值与具体标签的拆分 |
| `tagFilterKey` | `:205` 起（含 `:199` 附近关于空串 join 的注释） | 稳定 reset key，`listSourceKey` 用它 |
| 请求参数 | `:231-234`（`tagFilter.length > 0` + `paramsKey: tagFilterKey`） | 服务端 AND 过滤 |
| 空列表文案 | `:820` `emptyMessage={chatListEmptyMessage(isSearching, tagFilter.length)}` | 三态文案 |
| 行级标签编辑器 | `:832-839` `footer={<TagSelect className="imb-chat-tag-select" … allowCreate noClear …/>}` | **一个像素都不能动**（issue 文档结构纠正，@0 m00096） |

`TagSelect` 的过滤器语义全在 `src/renderer/components/tag-select/index.tsx`（`allowNoTag` 的 `handleChange` 双向互斥，`:76-95`），`MultiSelect` 的面板/键盘/portal 在 `src/renderer/components/multi-select/index.tsx`。**PP1 不动这两个文件，所以这些语义自动不变。**

### 1.4 实测几何（本会话 CDP 9224 只读取证）

对话模块（#002 修复后的构建，`index-C1scJDwf.css`，测试实例 PID 487264）：

| 项 | 值 |
| --- | --- |
| `.imb-pane-header` | 299×126 @ x=76,y=20 |
| `.imb-pane-header-top` | 283×48 @ x=84,y=20（`padding-bottom: 16px`） |
| `.imb-chat-search-stack` | 283×70 |
| 搜索框 `.imb-searchbox` | 283×32 |
| 标签筛选触发器 `.imb-chat-tag-filter .imb-ms-trigger` | 283×34 |
| `.imb-list` | 299×884 @ y=146 |

员工模块（今天实测，**这是目标参照**：单行头部、无筛选行）：

| 项 | 值 |
| --- | --- |
| `.imb-pane-header` | 299×88 @ x=76,y=20 |
| `.imb-pane-header-top` | 283×48 @ x=84,y=20（`padding-bottom: 16px`） |
| `.imb-searchbox` | 283×32 @ x=84,y=68 |
| `.imb-searchbox input` | 233×26 @ x=121,y=71 |
| `.imb-list` | 299×922 @ x=76,y=108 |

---

## 2. 组件 API 事实（决定了方案空间）

| 组件 | 关键事实 | 对方案的影响 |
| --- | --- | --- |
| `SearchInput`（`src/renderer/components/search-input/index.tsx:17-68`） | 只有 `value/onValueChange/placeholder/className/hint` + `...rest`（摊到 `<input>`）；**没有 trailing/adornment 插槽**，DOM 固定为 `.imb-searchbox > IconSearch + input + (kbd\|clear)` | 想把筛选控件放进盒子内部，必须改这个共享组件（6 个调用方） |
| `TagSelect`（`tag-select/index.tsx:39-121`） | 只透传 `className`（落到 `MultiSelect` 根 `.imb-ms`）和 `id`；其余 props 全是行为 | 只能从外部用 CSS 重塑触发器外观，**不能**改它的渲染结构 |
| `MultiSelect`（`multi-select/index.tsx:58-…`） | 自带：触发器 `button.imb-ms-trigger`（`role="combobox"`，**无 aria-label**，可访问名来自可见文本）、chips `.imb-ms-value/.imb-ms-chip`、`clearable` 时渲染 `.imb-ms-clear`（绝对定位，触发器兄弟节点）、面板 `createPortal` 到 `document.body` + `position:fixed` + `z-index:50`、`useDropdownPosition(rootRef, PANEL_MIN_WIDTH=200)`、`useClickOutside([rootRef,panelRef])` + `useEscapeKey` | 面板宽度 = `max(触发器宽, 200px)` → 触发器做窄了面板依然可读；**隐藏占位符会丢掉唯一可访问名** |
| `Popover`（`popover/index.tsx:53-110`） | `useClickOutside([anchorRef, panelRef], onClose, open)`，`mousedown` 时判断 `contains` | 与 MultiSelect 的 body portal **不兼容**（见 4.3） |
| 行级紧凑触发器先例 | `chat-module/index.css:99-140` 的 `.imb-chat-tag-select` 已经把「26px / 透明底 / muted / 隐藏 caret / 小 chips」这套写法跑通了 | PP1 直接复用这套视觉语言，评审时有无可争议的对照 |

`TagSelect` 6 个调用方（本次只动 chat 那个）：chat 列表筛选（`:799`）、chat 行级编辑（`:832`）、spend 筛选（`spend-module/index.tsx:228`，`.imb-spend-tag-filter`）、以及 employees/settings 侧的同族用法。**除 chat 列表筛选外全部不碰。**

---

## 3. 目标形态

```
现在（126px）                         目标（88px）
┌──────────────────────────────┐    ┌──────────────────────────────┐
│ 对话                     [+] │    │ 对话                     [+] │  ← header-top 48px
│ ┌──────────────────────────┐ │    │ ┌────────────────────┐ ┌───┐ │
│ │ 🔍 搜索对话        ⌘K   │ │    │ │ 🔍 搜索对话    ⌘K  │ │#标│ │  ← 一行 32px
│ └──────────────────────────┘ │    │ └────────────────────┘ └───┘ │
│ ┌──────────────────────────┐ │    └──────────────────────────────┘
│ │ 按标签筛选            ⌄ │ │    列表从 y=146 → y=108（+38px）
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

筛选触发器形态：**紧凑内联**——透明底、muted 文字、26px 高、无外框（hover/open 才出边框），未选时显示截断的「按标签筛选」，已选时显示 `#tag` chips，右侧一个 16px 的一键清除按钮。它**就是原来的 TagSelect**，只是换了外衣。

---

## 4. 候选方案

### 4.1 PP1（推荐）：同行紧凑触发器，纯 CSS 重塑

- 改动面：`chat-module/index.tsx` 1 个词 + `chat-module/index.css` 一个块。
- 不动任何共享组件 → 其他 5 个 `SearchInput` 调用方、其他 5 个 `TagSelect` 调用方零风险。
- 满足验收 #1/#2/#3/#4/#6/#7/#8 全部（映射见第 8 节）。
- 代价：chips 在窄栏下会被裁（见 9.4）；筛选控件在盒子**旁边**而非盒子**里面**（若老板坚持「必须在框内」，见 PP4）。

### 4.2 PP2（可选，需上游评估）：给 `MultiSelect` 加 `maxVisibleChips`

若已选标签 ≥3 个，触发器显示 `#a +2` 而不是堆 chips。改动在 `multi-select/index.tsx`（约 10 行：`selected.slice(0, max)` + `+N` 文本）+ 对应 CSS。收益是窄栏下更干净，代价是动共享组件、要单独回归 employees/settings/spend 三个 `MultiSelect` 消费方。**建议先上 PP1，PP2 作为后续独立 PR。**

### 4.3 PP3（已否决）：Popover 包 TagSelect —— 嵌套 portal 会让点击失效

看似最贴近「栏内筛选图标 + 弹层」，但**功能上是坏的**，机制（已读代码复验）：

1. `MultiSelect` 的面板 `createPortal(..., document.body)`（`multi-select/index.tsx:283-296`），是 `.imb-popover` 的 **body 级兄弟节点**，不在 Popover 的 `panelRef` 里。
2. `Popover` 的 `useClickOutside([anchorRef, panelRef], onClose, open)`（`popover/index.tsx:57`）在 **`mousedown`** 时判断 `el.contains(target)`；点选项时 target 在 MS 面板里 → 两个 ref 都不含它 → **`onClose()` 触发**。
3. `useClickOutside` 是 document 级监听（`src/renderer/hooks/use-click-outside.ts:19-29`），MultiSelect 自己的 `useClickOutside([rootRef, panelRef], closePanel, open)` 也在同一个 mousedown 上触发 → 面板关。
4. Popover `open=false` → `return null`（`popover/index.tsx:96`）→ 子树卸载 → portal 里的选项 DOM 在 `mouseup`/`click` 之前就被移除 → **`onChange` 永远不会触发**。用户看到的就是「点标签，面板关了，筛选没选上」。

要修得动共享代码：给 `useClickOutside` 加谓词/额外容器、或给 `MultiSelect` 加 `portalTarget`、或让 MS 面板在 `mousedown` 上 `stopPropagation`。三者都超出本 issue 的「最小 diff」范畴。**结论：不做。**

### 4.4 PP4（备选）：给 `SearchInput` 加 `trailing?: ReactNode`

把筛选控件真正放进 `.imb-searchbox` 盒子内部。改动在 `search-input/index.tsx`（约 6 行：props + `{trailing}` 渲染在 `input` 之后）+ `search-input/index.css`。非破坏性（可选 prop），但要回归 6 个调用方（chat-module、chat-input-bar、employees-module、settings-mcp、settings-skills、cron-module）。**只有当老板明确要求「必须在框内」时才做。**

---

## 5. PP1 最小 diff

### 5.1 `src/renderer/components/modules/chat/chat-module/index.tsx`（1 个词）

```diff
       search={
-        <div className="imb-chat-search-stack">
+        <div className="imb-chat-search-row">
           <SearchInput
             value={query}
             onValueChange={setQuery}
             placeholder={t("Search chats")}
             hint={IS_MAC ? "⌘K" : "Ctrl+K"}
           />
           <TagSelect
             className="imb-chat-tag-filter"
             value={tagFilter}
             options={tagOptions}
             allowNoTag
             placeholder={t("Filter by tags")}
             onChange={setTagFilter}
           />
         </div>
       }
```

其余全部原样。**不要顺手 reformat 这个块的任何一行。**

### 5.2 `src/renderer/components/modules/chat/chat-module/index.css`（替换 `:77-96` 整块）

```css
/* Search box + tag filter on one row inside the pane header's search slot.
   The filter is the very same TagSelect as before — only its trigger is
   restyled, so the panel, keyboard nav, click-outside and the "No tags"
   exclusion are inherited unchanged. */
.imb-chat-search-row {
  display: flex;
  align-items: center;
  gap: var(--imb-space-1);
  min-width: 0;
}

.imb-chat-search-row .imb-searchbox {
  flex: 1 1 auto;
  min-width: 0;
}

/* Compact trigger: the row-level tag editor's visual language (see
   .imb-chat-tag-select below) — borderless until hovered/open, so it reads
   as part of the search bar rather than as a second box. */
.imb-chat-tag-filter {
  flex: none;
  width: auto;
  max-width: 45%;
}

.imb-chat-tag-filter .imb-ms-trigger {
  min-height: 26px;
  padding: 2px 8px;
  gap: 6px;
  border-color: transparent;
  background: transparent;
  color: var(--imb-muted);
  font-size: var(--imb-text-sm);
}

.imb-chat-tag-filter .imb-ms-trigger:hover:not(:disabled) {
  border-color: var(--imb-border);
  background: var(--imb-surface);
  color: var(--imb-fg);
}

.imb-chat-tag-filter .imb-ms-trigger[aria-expanded="true"] {
  border-color: var(--imb-accent);
  background: var(--imb-surface);
  color: var(--imb-fg);
}

/* The caret only ever opens the panel, which the click already does; at
   ~300px of pane it costs ~20px the search input needs more. */
.imb-chat-tag-filter .imb-ms-caret {
  display: none;
}

/* Placeholder and chips stay on one line; the clear button covers overflow. */
.imb-chat-tag-filter .imb-ms-value {
  flex-wrap: nowrap;
  overflow: hidden;
}

.imb-chat-tag-filter .imb-ms-chip {
  flex: none;
  padding: 1px 6px;
  font-size: var(--imb-text-xs);
}

.imb-chat-tag-filter .imb-placeholder {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Clear-all: the full-width trigger reserves 38px for it; 24px is enough
   for the 16px control once it is pulled in to right: 4px. */
.imb-chat-tag-filter.imb-ms-has-clear .imb-ms-trigger {
  padding-right: 24px;
}

.imb-chat-tag-filter .imb-ms-clear {
  right: 4px;
  width: 16px;
  height: 16px;
}
```

`.imb-chat-search-stack` 整条规则（含其上的注释）随本次改动删除，不要再留死规则。

### 5.3 每条规则为什么这么写

| 规则 | 理由 |
| --- | --- |
| `.imb-chat-search-row { display:flex; align-items:center; gap: var(--imb-space-1); min-width:0 }` | 一行布局；4px 间距与原来两行之间的 gap 同一个 token，节奏不变 |
| `.imb-chat-search-row .imb-searchbox { flex:1 1 auto; min-width:0 }` | 搜索框吃剩余宽度；`min-width:0` 是 flex 子项能被压缩的前提（验收 #6） |
| `.imb-chat-tag-filter { flex:none; width:auto; max-width:45% }` | 触发器不被压缩也不抢宽度；45% ≈ 127px 上限保证搜索框至少拿到 ~150px |
| `.imb-ms-trigger { min-height:26px; padding:2px 8px; gap:6px; 透明底; muted; --imb-text-sm }` | 逐字复用 `.imb-chat-tag-select .imb-ms-trigger`（`index.css:104-114`）的紧凑语言：26px 控件、发丝线、quiet。**唯一有意偏差：字号取 `--imb-text-sm`(13px) 而非行级的 `--imb-text-xs`(11px)**——11px 在 26px 行内已经偏小，头部这个控件要可读性；若想完全对齐行级，把这一行换成 `--imb-text-xs` 即可，其余不受影响 |
| `:hover` / `[aria-expanded="true"]` 才出边框 | 「低调直到交互」，与行级触发器（`index.css:116-126`）一致 |
| `.imb-ms-caret { display:none }` | 省 ~20px；行级触发器同样隐藏（`index.css:137-139`）。**若觉得太素，删掉这条即可，其余不受影响** |
| `.imb-ms-value { flex-wrap:nowrap; overflow:hidden }` | 多选 chips 不换行、不把行撑高；溢出由清除按钮兜底 |
| `.imb-ms-chip { flex:none; padding:1px 6px; font-size: var(--imb-text-xs) }` | 与行级 chips（`index.css:132-135`）同规格 |
| `.imb-placeholder { nowrap + ellipsis }` | 「按标签筛选」5 个字在窄栏截断而不是把搜索框挤没；文本仍在 DOM 里，可访问名不丢 |
| `.imb-ms-has-clear .imb-ms-trigger { padding-right:24px }` + `.imb-ms-clear { right:4px; 16px }` | 上游给整宽触发器留的是 `padding-right:38px` / `right:10px` / 18px（`multi-select/index.css:110-125`），紧凑形态要按比例收回 |
| **不写** `!important` | 全部靠特异性赢（见 5.4），与 #002 的 `.imb-pane-action-btn` 同一纪律 |

### 5.4 特异性对照（私有层会来抢，必须高一格）

`src/renderer/private/overrides.css` 里与触发器相关的规则（私有 CSS 在 `src/renderer/main.tsx` 里 `import "./private";` **最后**加载，同特异性时私有层赢）：

| 私有层规则 | 特异性 | 本文规则 | 特异性 | 结果 |
| --- | --- | --- | --- | --- |
| `.imb-ms-trigger:hover:not(:disabled)`（`overrides.css:503`） | (0,3,0) | `.imb-chat-tag-filter .imb-ms-trigger:hover:not(:disabled)` | (0,4,0) | 本文赢 ✓ |
| `.imb-ms-trigger:focus-visible, .imb-ms-trigger[aria-expanded="true"]`（`overrides.css:509-514`） | (0,3,0) | `.imb-chat-tag-filter .imb-ms-trigger[aria-expanded="true"]` | (0,4,0) | 本文赢 ✓ |
| `.imb-ms-chip`（`overrides.css:61`，只改 color） | (0,1,0) | `.imb-chat-tag-filter .imb-ms-chip` | (0,2,0) | 本文赢（但 color 仍走私有层的 accent-text，这是想要的）✓ |
| `.imb-ms-panel`（`overrides.css:164`，动画/阴影/模糊） | (0,1,0) | 不覆盖 | — | 私有层的面板观感保留 ✓ |
| `.imb-ms-has-clear` / `.imb-ms-clear` | 无命中 | — | — | 无障碍争 ✓ |

已核验这些选择器确实进了构建产物（`out/renderer/assets/index-CtQnmfFE.css`，`.imb-ms-trigger:hover:not(:disabled)` 出现 2 次 = 上游 + 私有各一次）。

### 5.5 token 取值（`src/renderer/styles/tokens.css`，私有层覆写后）

`--imb-space-1: 4px`(:43)、`--imb-text-sm: 13px`(:33)、`--imb-text-xs: 11px`(:32)、`--imb-muted`(:8/#999)、`--imb-border`(:10/#3a3a3a)、`--imb-surface`(:4/#2c2c2c)、`--imb-fg-soft`(:88)、`--imb-radius-md` 私有层 10px（`private/theme.css:74`）。`--imb-header-h` 不存在，不要用。

---

## 6. 几何预测（自测可直接断言）

按 5.2 的 diff，行高 = `max(搜索框 32px, 触发器 26+2×2px)` = **32px**：

| 项 | 现在 | 预测（PP1 后） | 员工模块实测（参照） |
| --- | --- | --- | --- |
| `.imb-pane-header` 高 | 126 | **88** | 88 ✓ |
| `.imb-list` y / 高 | 146 / 884 | **108 / 922** | 108 / 922 ✓ |
| `.imb-searchbox` | 283×32 | 283×~192（flex 后） | 283×32（独占） |
| 触发器宽 | 283 | ~87（占位符态） | — |
| 输入框可用宽 | ~150 | ~106（空态带 ⌘K）/ ~144（输入态） | ~233 |

即：**修完后对话中栏头部与员工中栏头部各项数值一致**。这是一组非常硬的断言，见第 8 节。
（触发器宽度是按 13px 字号 × 5 个汉字 + padding 估算，**待 @5 实测确认**。）

---

## 7. 复测/自测用的 CDP 配方

测试实例：`bash scripts/private/run-test-env.sh`（PID/端口见 `~/.imboss-ui-test/imboss-test.pid`，CDP `http://127.0.0.1:9224`；老板实例 PID 261970 / `~/.imboss` 禁碰）。

```bash
cd "/workshop/Github repos/ai-assistant-dev/orca-imboss"
# 导航到对话（合成 click 后 React 异步 flush，读 DOM 前等 600–900ms）
node scripts/private/cdp-eval.mjs --eval 'document.querySelectorAll(".imb-nav-item")[0].click()'
node scripts/private/cdp-eval.mjs --eval '<measure js>'
node scripts/private/cdp-eval.mjs --shot /tmp/004-chat.png
```

断言脚本骨架（把 `<measure js>` 换掉即可）：

```js
(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => el ? (({x,y,width,height}) => ({x:Math.round(x),y:Math.round(y),w:Math.round(width),h:Math.round(height)}))(el.getBoundingClientRect()) : null;
  return JSON.stringify({
    header: box(q(".imb-pane-header")),
    headerTop: box(q(".imb-pane-header-top")),
    row: box(q(".imb-chat-search-row")),
    searchbox: box(q(".imb-chat-search-row .imb-searchbox")),
    input: box(q(".imb-chat-search-row .imb-searchbox input")),
    trigger: box(q(".imb-chat-tag-filter .imb-ms-trigger")),
    triggerText: q(".imb-chat-tag-filter .imb-ms-trigger")?.textContent?.trim() ?? null,
    clearBtn: box(q(".imb-chat-tag-filter .imb-ms-clear")),
    list: box(q(".imb-list")),
    stackGone: q(".imb-chat-search-stack") === null,
    rowTagSelect: box(q(".imb-chat-tag-select .imb-ms-trigger")),   // 行级：必须仍在且原样
  }, null, 1);
})()
```

三态视口：窄（≈900×700）/ 常规（1262×1030）/ 宽（≈1600×1000），各截一张图存 `scripts/private/issues/evidence/004-*.png`（untracked，别 `git add -A`）。

---

## 8. 自测清单（验收 7 条逐条映射）

| # | 验收 | 怎么验 | 通过标准 |
| --- | --- | --- | --- |
| 1 | 独立第二行移除 | `.imb-chat-search-stack` 选择器命中数 = 0；`.imb-chat-search-row` 存在；`.imb-pane-header` 高 88 | 头部回到「标题 + 一行」 |
| 2 | 能力完整保留 | 点开触发器：多选、`无标签` 选项在列、可搜索、可多选取消 | 与改前逐项等价（它是同一个组件） |
| 3 | 行为一致 | 选标签 → 列表走服务端（`serverMode`）；清空 → 回本地列表；`onChange` 仍 `setTagFilter` | 只看 diff：`tagFilter/serverMode/tagFilterKey/chatListEmptyMessage` 零改动 |
| 4 | 生效条件可见 + 一键清除 | 选 1 个标签 → 栏内出现 `#tag` chip + 16px 清除按钮；点清除 → 回「按标签筛选」占位态、列表复位 | chip 与 clear 都在栏内可见 |
| 5 | 联动不回归 | 空列表文案三态（搜索中 / 有标签 / 无标签）；`paramsKey` 复位 | 与改前一致 |
| 6 | 窄宽可用 | 窄视口下输入框可点击可输入；触发器可点；无横向溢出 | 输入框宽 ≥ ~100px，触发器不被压没 |
| 7 | quiet 视觉 | 截图三态；hover/open 才出边框；26px 控件； chips 11px | 与行级 `.imb-chat-tag-select` 同语言 |
| 8 | 其他模块无回归 | 员工 / 设置 / 定时 / 统计 四个模块逐一打开；**行级 `.imb-chat-tag-select` 在每条对话行下照旧**（点击能开面板、能建标签、`noClear` 无清除钮） | 无视觉/功能变化 |

额外必做：
- `pnpm run typecheck && pnpm run build`（在真实 HOME 下跑；`pnpm` 是 mise shim，换 HOME 会报 `mise ERROR pnpm is not a valid shim`）。
- 键盘：`Tab` 到触发器 → `Enter`/`↓` 开面板 → `↑↓` 移动 → `Enter` 切换 → `Esc` 关面板；`⌘K/Ctrl+K` 仍聚焦搜索框（`chat-module/index.tsx:611-628` 用 `document.querySelector(".imb-searchbox input")`，本改动不新增 `.imb-searchbox`，所以不受影响）。
- ⚠️ **CDP 键盘陷阱（@3 实测，见 m00147）**：用 `Input.dispatchKeyEvent` 发 Enter/Space 验证按钮类控件的默认激活动作时，**必须带 `text` 字段**（Enter 传 `\r`、Space 传 ` `）。不带的话 Chromium 不执行默认激活，会看到「按了没反应」的**假失败**——@3 一开始也误判成应用拦截了 Enter，是靠注入裸按钮做对照实验才定位到是 CDP 用法问题。本 issue 自测键盘时别被这个假阴性带偏。
- 回归 #001：图谱模块单栏版面铺满（`.imb-graph-stage` 实测 1054×877 @1262×1030；@3 在 `3e5fcee` 上复测为 `.imb-graph` 1186px == `.imb-contentpane` 宽）。

---

## 9. 风险与边界

### 9.1 冻结路径：已解除（分两步，均非本 blueprint 所致）

@0 消息 id 130 的冻结令（不 add / 不 commit / 不 stash / 不 checkout / 不 rebase 那 4 个路径）**对 #002 的 4 个修复路径已失效**，实际经过两步：

1. 老板于 2026-10-19 07:5x 亲自把 21 个暂存 WIP 落成 **`3e5fcee refactor(private): quiet baseline consolidation and graph-infrastructure removal`**（21 files, +593/−2187），暂存区随之清空；
2. @5 的 #002 修复随后落成 **`9aaf0a9 feat(ui): pane header + actions for chat and employees, drop footer buttons`**（4 files, +85/−12：`list-pane/index.css`、`list-pane/index.tsx`、`chat-module/index.tsx`、`employees-module/index.tsx`）。

（出处勘误：本文档初版把这两步混为一个 commit，误写成「老板把 21 个 WIP 落成 9aaf0a9」；据 @0 消息 id 162 与 `git show --stat` 核实，`3e5fcee` 才是 21 个 WIP 的落账，`9aaf0a9` 是 @5 的 feat commit。结论不变：4 个路径现在 `git status` 干净，MM 叠加风险已消失。）

由此产生的两个实际问题，@0 已裁定（消息 id 162）：

1. **不存在拆 hunk 问题**——#002 已在 `9aaf0a9` 落账，#004 的提交天然独立，@5 正常 `git add -N <路径>` + `git commit --only <同路径>` 单主题 commit 即可，不需要 `diff.context=0 add -p` 那套。（前提留档备查：#002 的 `actions={…}` 块在 `:779-790`，紧接着就是 `:791` 的 `search={…}`，相距 0 行；将来若真要把它们分开，默认 3 行上下文会把两者并成一个 hunk。）
2. **回滚 #004 不要用 `git checkout --`**——现在 index 与 HEAD 都是干净的，#002 的修复已在 `9aaf0a9` 里，`git checkout --` 只会丢 #004 自己的改动；但若 #004 与后续别的改动混在工作区，最稳的回滚仍是：`git diff -- <路径> > /tmp/004.patch` 存档，再 `git apply -R --check /tmp/004.patch && git apply -R /tmp/004.patch`。

**建议顺序**：@5 可以直接开工（无 MM 叠加风险了），自测通过后提交；提交时仍守 `git add -N <路径>` + `git commit --only <同路径>`，且**先看一眼 `git diff --cached` 是否为空**（本文档交付时暂存区为空、工作区干净）。

### 9.2 行级 `TagSelect` 不能动

`chat-module/index.tsx:832-839` 的 `footer={<TagSelect className="imb-chat-tag-select" …/>}` 与 `index.css:99-140` 的样式是给单条对话打标签用的，issue 文档的结构纠正（@0 m00096）明确点名。PP1 的所有新规则都挂在 `.imb-chat-tag-filter` 下，**不会**命中 `.imb-chat-tag-select`；但改 CSS 时别把这两个类名写混。

### 9.3 不许回退成 040ae10 的单选 chips 行

`imb-chat-filter-row` / 单选 chips / `"+N"` 独立行是旧形态，暂存 WIP 已换成多选 `TagSelect`。本 issue 的验收以当前多选行为为准。

### 9.4 已知局限：多选 chips 在窄栏会被裁

`max-width: 45%`（≈127px）下，3 个以上标签的 chips 会被 `.imb-ms-value { overflow:hidden }` 裁掉。验收 #4 只要求「至少显示已选数量或已选标签 chips」，已选 1–2 个时完全可读；要更好的「`#a +2`」效果就走 PP2（独立 PR）。**这是 PP1 的已知代价，不是 bug。**

### 9.5 Escape 的双重行为

焦点在搜索框且筛选面板开着时按 `Esc`：`useEscapeKey` 关面板 + `SearchInput` 的 `onKeyDown`（`search-input/index.tsx:41-47`）清空搜索词。两者都会发生。属既有组件行为的叠加，非本次引入；若要修，改 `SearchInput`（共享组件），另开 issue。

### 9.6 不要顺手动的地方

- `spend-module/index.tsx:228` 的 `.imb-spend-tag-filter` 是同族形态（在 filters 块里，不在搜索栏），**本次不碰**；老板哪天要统一，可按同一套 CSS 再做。
- 不要 reformat `chat-module/index.tsx` / `index.css` 的任何无关行（上游文件纪律）。
- 不要给 `MultiSelect` / `SearchInput` / `TagSelect` 加 props（那是 PP2/PP4 的事）。

---

## 10. 交付物

- 本文档：`scripts/private/issues/004-blueprint.md`
- issue 原文件：`scripts/private/issues/004-chat-tag-filter-into-searchbar.md`（状态 `verified`）
- #002 的同口径文档（含 git 纪律与 MM 陷阱）：`scripts/private/issues/002-blueprint.md`（commit `5420847`）
