# 010 — 员工卡美学降噪与高级质感重塑：克制静谧、成熟设计语言（参考 Linear/Raycast/Collect UI）

- 状态：fixed-verified
- 报告人：Boss
- 负责人：AI Assistant
- 严重程度：enhancement
- 组件/区域：员工模块详情页（`src/renderer/components/modules/employees/employee-detail/index.css` 及 `index.tsx`）
- 相关提交：`mine` @ `6e263ad`

## 环境

- 分支：`mine` @ `6e263ad`
- 构建：`pnpm run build`（electron-vite build，产物 `out/`）
- 启动：`scripts/private/run-live.sh --no-build`（守护进程 `app-orca-imboss-live.service`）
- 主机/后端：Linux + Wayland

## 报告描述

Boss：“功能上我比较满意了，但是美观度上我觉得有很大的优化空间，动态效果可能带来了极大的视觉负担，太浮夸了哈哈，我感觉网上应该有非常成熟且美观的设计可以借鉴”

## 现状病灶与根因分析

1. **动态效果与高饱和反差导致的视觉负担（Visual Noise & Over-the-top Effects）**：
   - 全息层 `.imb-card-sheen` 采用了 6 色高饱和色彩虹渐变与强烈的 `color-dodge` 混合模式，鼠标划过时光影过于喧宾夺主，造成“浮夸”和“晃眼”的负面感；
   - 铂金黑金等级采用了偏黄的强金色放射渐变与厚重金框，略显庸俗，缺少科技界顶级软件（如 Linear、Raycast）的静谧与内敛高级感；
   - 钛金等级采用了 2px 密集的平铺拉丝条纹，高分辨率下易产生视觉摩尔纹和频闪；
   - 顶部挂绳孔带有凸出的假金属片，显现出拟物“玩具感”，削弱了现代极简 Collect UI 的建筑质感。
2. **成熟且美观的标杆对齐（Linear / Raycast / Apple Pro 级设计语言）**：
   - **克制的光影哲学（Understated Elegance）**：质感应当是“暗藏底蕴、触碰时隐隐可感”，而不是高对比度地跳入眼帘；
   - **柔和的丝绸漫反射（Silky Spotlight Sheen）**：彻底移除刺眼的 6 色彩虹条纹，改为以单色/冷香槟色为主的柔和光圈（Silky Spotlight，透光度控制在 0.05~0.12），在光标掠过时呈现如同磨砂玻璃或金属阳极氧化层的细腻微漫射；
   - **现代 4 阶低饱和材质系统**：
     - **原浆纸质（Kraft/Alabaster）**：暖白天鹅绒质感，柔和温润底色与微凹发丝线；
     - **磨砂 PVC（Frosted Acrylic）**：纯净半透明微晶扩散，冷白发丝倒角，轻盈现代；
     - **喷砂钛金（Bead-blasted Titanium）**：如同 iPhone 15 Pro / Apple Watch Ultra 的哑光细腻金属微粒喷砂，消除密集条纹；
     - **午夜曜石（Midnight Obsidian）**：深邃平滑的午夜黑，点缀极其克制的香槟金发丝线；
   - **极简一体化结构与 Bento 排版**：
     - 去除顶部生硬的拟物金属挂件，改为极简胶囊切槽（Integrated Capsule Notch）；
     - HUD 看板与技能药丸全面接入轻盈的 Collect UI 半透明胶囊（Air Pills），字重节律分明、留白充裕、呼吸感强。

## 验收证据

- 截图 1（克制高级的午夜曜石材质、柔和丝光漫反射与精致 Bento）：`evidence/010-employee-card-subtle-aesthetic-polish/01-refined-obsidian-card.png`
- 截图 2（极简原浆纸质工牌与一体化胶囊切槽）：`evidence/010-employee-card-subtle-aesthetic-polish/02-refined-paper-card.png`

## 验收标准

- [x] **视觉降噪与去浮夸**：彻底消除高饱和彩虹条纹与刺眼闪烁，光影改用柔和丝滑的冷光微漫反射（Silky Spotlight），彻底告别光污染。
- [x] **成熟 4 阶高级材质**：各阶材质转为低饱和、细腻哑光的顶级材质（暖白纸感、纯净雾面 PVC、喷砂钛金、香槟午夜曜石），耐看舒适。
- [x] **一体化极简工牌轮廓**：去掉玩具感挂件，挂绳切槽与边框融为一体，Bento 栅格规整利落。
- [x] **清爽技能与算力面板**：平铺药丸徽章色彩柔和、排版透气；LED 思考指示灯细腻精致。
- [x] **构建与测试全量 PASS**：测试通过（20/20 passed），上游无侵入。

## 处理记录

| 日期 | 状态 | 操作人 | 说明 |
| --- | --- | --- | --- |
| 2026-10-21 | verified | AI Assistant | 确证视觉过度与浮夸病灶，确立 Linear/Raycast/Collect UI 级克制高级美学方案，立案建档 |
| 2026-10-21 | fixed-verified | AI Assistant | 重塑克制高级视觉，消除彩虹光污染，接入丝绸微漫射与成熟四阶材质，CDP 复验通过并留存对比截图 |
