# 004 · 标签筛选应并入搜索栏（去掉独立的第二行筛选控件）

- **状态**: `verified`（已核实，等待修复）
- **报告人**: Boss（chat 10）
- **负责人**: UI 修复负责人（@4）
- **严重程度**: 中（中栏头部占两行，视觉冗余）
- **组件/区域**: 对话模块中栏（chat-module 的 ListPane 头部）
- **相关提交**: 当前 `mine` HEAD `3da025f`（含 Boss 暂存 WIP）
- **环境**:
  - 分支 `mine`，commit `3da025f`
  - 构建：`scripts/private/run-test-env.sh` 默认模式
  - 启动：`HOME=~/.imboss-ui-test`、`CDP 9224`、`--no-sandbox --ozone-platform=wayland`
  - 视口 1262×1030；中栏宽 300px；宿主 Wayland

## 报告描述

Boss：「按标签筛选的功能可以集成到搜索栏里面去，这样会比较简洁」。

实测：中栏头部当前占 **两行控件**——第一行搜索框（283×34），第二行一个整宽的「按标签筛选」下拉触发器（283×34）。两行各自独立成块，头部总高 123px。Boss 希望把筛选能力收进搜索栏，让头部回到一行。

## 复现步骤

1. 启动隔离测试实例（CDP 9224）。
2. 点击左侧导航「对话」。
3. 看中栏头部：标题「对话」下方第一行是搜索框（放大镜图标 + `Ctrl+K` 提示），第二行是「按标签筛选」下拉（caret 图标）。

## 证据

- `evidence/004-chat-search-and-tag-filter.png` — 中栏 300px 宽：搜索框与「按标签筛选」下拉各占一整行，中间无关联，头部 123px。

CDP 实测（`CDP_PORT=9224`）：

| 项 | 值 |
| --- | --- |
| 中栏 pane 宽 | 300px |
| `.imb-pane-header` 高 | 123px |
| `.imb-pane-title`（「对话」） | y=20 h=45 |
| `.imb-chat-search-stack` | x=216 y=65 w=283 h=70（内含两行） |
| 搜索框 `.imb-searchbox` | 283×34 |
| 标签筛选触发器 `.imb-chat-tag-filter .imb-ms-trigger` | x=216 y=101 w=283 h=34 |

## 根因分析 / 现状定位

`src/renderer/components/modules/chat/chat-module/index.tsx:775-792` 把搜索与筛选当作两个并列子节点塞进同一个 `search` 插槽：

```tsx
search={
  <div className="imb-chat-search-stack">
    <SearchInput value={query} onValueChange={setQuery} placeholder={t("Search chats")} hint={…} />
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

CSS 在 `src/renderer/components/modules/chat/chat-module/index.css:79-95`：`.imb-chat-search-stack` 与 `.imb-chat-tag-filter` 都是纵向堆叠（前者 `display:flex; flex-direction:column`，后者触发器 `width:100%`），所以必然形成两行。

筛选状态与逻辑（供修复时保持一致）：
- `const [tagFilter, setTagFilter] = useState<string[]>([])`（第 118 行）——**多选数组**，不是单选；
- `noTagFilter = tagFilter.includes(TAG_FILTER_NONE)`（第 195 行）→ `allowNoTag` 即「无标签」这一虚拟选项；
- `serverMode = isSearching || tagFilter.length > 0`（第 192 行）；
- 请求参数键 `tagFilterKey`（第 204 行起）与 `paramsKey: tagFilterKey`（第 233 行）；
- 空列表文案 `chatListEmptyMessage(isSearching, tagFilter.length)`（第 812 行）。

注意：`040ae10` 时代是另一种形态（单选的「全部 + 标签 chips + "+N"」独立行 `imb-chat-filter-row`），暂存 WIP 已把它换成现在这个多选 `TagSelect`。**本 issue 的验收以当前工作区的多选 `TagSelect` 行为为准**，不要回退到单选。

**结构纠正（@0，m00096 核对当前代码）**：`src/renderer/components/modules/chat/chat-module/index.tsx:775-795` 是 `imb-chat-search-stack` 内**纵向堆叠**两个整宽控件——`SearchInput`（搜索）+ `TagSelect`（`allowNoTag`、`value={tagFilter}` 数组、`placeholder=t("Filter by tags")`、`options=tagOptions`）。另外 **ListRow footer 里还有一个行级 `TagSelect`（`.imb-chat-tag-select`，给单条对话打标签用）——那个不能动**，只改列表筛选那一个。

## 验收标准

1. 独立的第二行筛选控件移除：`.imb-chat-search-stack` 内不再出现第二个整宽行，中栏头部回到「标题 + 一行搜索栏」。
2. 标签筛选能力完整保留并集成进搜索栏，形态由 @4 定（栏内筛选图标 + 弹层，或栏内可移除 chips 均可），但必须保留现有全部能力：多选、`allowNoTag`（「无标签」虚拟选项）、`options={tagOptions}`。
3. 筛选行为与现状一致：仍是多选 `tagFilter` 数组，`onChange` 仍走 `setTagFilter`；不得改成单选或改语义。
4. 当前生效的筛选条件在栏内可见（至少显示已选数量或已选标签 chips），且可一键清除（清空后回到「按标签筛选」占位态）。
5. 联动不回归：`serverMode`（`isSearching || tagFilter.length > 0`）、`tagFilterKey` 请求参数、空列表文案 `chatListEmptyMessage(isSearching, tagFilter.length)` 三条链路行为不变。
6. 中栏窄宽度（≈300px）下可用：搜索框不被筛选控件挤压到无法输入，筛选入口仍可点击。
7. 视觉符合当前 quiet 语言：发丝线边框、36px 级别控件、与 `.imb-searchbox` 同一基线；不放第二个整宽行。
8. 其他模块无回归（employees / 设置等不受影响）；**ListRow 行级 `TagSelect`（`.imb-chat-tag-select`）保持原样**，不得随本次改动被移除或改行为。

## 处理记录

| 日期 | 操作 | 结果 |
| --- | --- | --- |
| 2026-10-18 | 实测 `3da025f` 测试实例的对话中栏头部 | 确认搜索框与标签筛选各占一整行，头部 123px，两行无视觉关联 |
| 2026-10-18 | 读取 `chat-module/index.tsx:775-812` 与 `index.css:79-95` | 定位到 `imb-chat-search-stack` 内并列 `SearchInput` + `TagSelect`，CSS 纵向堆叠 |
