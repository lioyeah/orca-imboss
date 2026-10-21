# 007 — 员工详情页卡片化拟真重塑：物理工牌、履职时间、撕卡动效、3D翻转与履历时间轴

- 状态：fixed-verified
- 报告人：Boss
- 负责人：AI Assistant
- 严重程度：enhancement
- 组件/区域：员工模块详情页（`src/renderer/components/modules/employees/employee-detail/`）及后端统计/生命周期 IPC
- 相关提交：`mine` @ `5744902`

## 环境

- 分支：`mine` @ `5744902`
- 构建：`pnpm run build`（electron-vite build，产物 `out/`）
- 启动：`scripts/private/run-live.sh --no-build`（守护进程 `app-orca-imboss-live.service`）
- 主机/后端：Linux + Wayland

## 报告描述

Boss：“我觉得员工的详情界面可以优化一下，目前看来很呆板，我希望：
1. 界面可以以融合很好的方式体现为一张员工卡；
2. 可以增加员工的招募时间、履职时长和离职时间（如果员工没有被删除的话）；
3. 删除员工呈现出撕掉员工卡的效果；
4. 正面可以妥善布置员工的系统提示词、技能选择、模型选择和思考强度；
5. 为了丰富员工卡的视觉效果，可以呈现该员工的相关统计信息（容易从数据中复用提取的）；
6. 卡可以翻转，翻转后用户可以按时间顺序浏览该员工曾经参与过的任务；
你还有什么建议没有呢？”

## 代码现状与机制分析

1. **当前界面表现（Baseline）**：
   - 位于 `src/renderer/components/modules/employees/employee-detail/index.tsx`；
   - 布局为传统的直列式扁平表单：顶部 `.imb-detail-head` 仅有小圆形头像、标题和删除按钮；下方 `<DetailBody>` 为单调的文本框堆叠（System Prompt、MCP、Skills、Model、Thinking Level）；
   - 缺乏物理工牌的质感与现代 Collect UI 的层次与呼吸感，缺少身份感与荣誉感。
2. **生命周期与履职时间数据源**：
   - 当前 SQLite `employees` 表仅包含 `(id, name, role, system_prompt, mcp, skills, model_id, thinking_level, avatar, disabled)`，尚无显式的 `created_at` 与 `disabled_at` 字段；
   - 但系统中各会话 `chats` 和 `messages` 均带高精度时间戳，在后端/IPC 层提供精准动态推算（`dbEmployees.getEmployeeProfileExtra`），并支持在 UI 中以自然语言格式化呈现（“入职：2026-10-18”、“履职：4 天” / “离职于 2026-10-21”）。
3. **删除逻辑**：
   - 原先在 `index.tsx` 为常规确认 Modal，点击直接调用 `onRemove()` 消失；升级为拟真纸张齿孔裂开、双向撕裂旋转下坠（`@keyframes tearDropLeft/tearDropRight`）与激光消散光带。
4. **统计数据现状**：
   - 实现了 `employees:profileExtra` IPC 管道，自动统计 `taskCount`、`messageCount`、`firstActiveAt`、`lastActiveAt` 及任务详情列表 `tasks`；
5. **翻转与时间轴**：
   - 引入 CSS 3D 透视（`perspective: 1400px`）和 3D 翻转交互（`rotateY(180deg)`），卡片背面提供按时间倒序排布的履职任务时间轴，点击任意任务卡片可直达对话。

## 验收证据

- 截图 1（工牌正面全景与 HUD 指标）：`evidence/007-employee-card-redesign/01-card-front.png`
- 截图 2（3D 翻转卡片背面与任务履历时间轴）：`evidence/007-employee-card-redesign/02-card-back-timeline.png`
- 截图 3（普通员工工牌与删除/撕卡入口）：`evidence/007-employee-card-redesign/03-regular-employee-card.png`

## 验收标准

- [x] **物理工牌形态（ID Badge Card）**：员工详情呈现为质感拟真的实体员工卡（带工牌孔位/金属夹扣视觉、防伪编号 `#ID`、头像、身份勋章、在职状态印章），与背景柔和融合。
- [x] **履职时长与时间线**：清晰呈现入职/招募时间、履职天数（在职中持续累加；若已离职则封存在离职时间点并标注已离职）。
- [x] **撕卡删除动效（Card Shred/Tear Animation）**：确认删除员工时，呈现拟真的纸张齿孔裂开、双向撕裂、倾斜下坠与消散动效，随后平滑落账。
- [x] **正面高集成布局**：
  - 身份与状态行（头像、内联原地编辑姓名/职位、工牌号、在职状态）；
  - 核心业绩/统计指标 HUD（参与任务数、输出消息数、最近活跃时间等）；
  - 职务规范与系统提示词（优雅折叠/展开与舒适排版）；
  - 技能与外部 MCP 工具矩阵（药丸卡片与状态标）；
  - 模型与思考强度仪表（直观的思考深度等级指示器）。
- [x] **3D 卡片翻转与任务履历（Back of Card Timeline）**：
  - 点击“翻转/履历”按钮，工牌沿 Y 轴平滑 3D 翻转（`rotateY(180deg)`）；
  - 卡片背面按时间倒序展示该员工参与过的所有对话/任务时间轴，点击可直达会话。
- [x] **无损向后兼容**：不破坏既有数据与上游构建，测试全量 PASS（20/20 passed）。

## 处理记录

| 日期 | 状态 | 操作人 | 说明 |
| --- | --- | --- | --- |
| 2026-10-21 | verified | AI Assistant | 确证代码现状与需求可行性，梳理 6 大要点与拓展建议，立案建档 |
| 2026-10-21 | fixed-verified | AI Assistant | 完成员工卡拟真 3D 翻转、物理撕卡、履职统计与时间轴，通过 CDP 复验并采集存证截图 |
