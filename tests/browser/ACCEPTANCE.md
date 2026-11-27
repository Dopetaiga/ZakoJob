# present-job-board 1.1 / 1.2 / 3.1 · demo.html 桌面 Edge 浏览器验收

日期：2026-11-26 · 分支：qa/board-acceptance · 结论：**三项均通过**

## 运行环境

| 项 | 值 |
| --- | --- |
| 系统 | Windows 10.0.26200 x64 |
| Node | v22.23.2 |
| 浏览器 | Microsoft Edge 158.0.4370.33（Playwright `channel: "msedge"`，headless） |
| 依赖 | `npm ci --prefer-offline --registry=https://registry.npmjs.org`（@playwright/test 1.56.1、vite 7.x、misans 5.0.0） |
| 服务 | Vite 程序 API `createServer`，专属随机端口（20000–39999 区间 + `strictPort`），每个 spec 独立实例，用后关闭；未改共享 `vite.config.ts` |
| 用例 | `tests/browser/*.spec.ts`，仅新增于 `tests/browser/` |
| 命令 | `npx playwright test -c tests/browser/playwright.config.ts` |
| 结果 | **33/33 通过**。前 32 项连续通过三次，加入两种菜单容器的切换用例后，完整复跑耗时 22.2 秒。 |

## 1.1 字体与字重 — 通过

- 实际字型（CDP `CSS.getPlatformFontsForNode`，证据见 [evidence/fonts-1.1.json](evidence/fonts-1.1.json)）：
  中文 17 字形、拉丁 25 字形、数字 15 字形，**全部由 "MiSans VF" 渲染**。
- 字重：核对条 400/600/650 声明正确；同文本实测宽度 **251.55 → 263.17 → 266.11 px**，650 与 600 有实际区分，MiSans VF 可变字重真实生效；`document.fonts.check('650 16px "MiSans VF"')` 为 true。
- 「设置 → 关于」署名齐全：MiSans（MiSans VF 5.0.0）、版权归小米所有、MiSans 官方使用说明与 misans@5.0.0 链接。
- 阻断字体回退：拦截全部 woff2 后自动落到 **Microsoft YaHei**，四份样本完整、无横向溢出，「更新进展 → 标记二面已面」仍可完成。
- 表单控件的计算字号为 16px，与设计变量一致。
- 在演示页切换系统回退字体后，岗位卡使用系统字形，切回后恢复 MiSans。

## 1.2 桌面横向进展卡 — 通过

- 宽屏 1440：四份设计基底样本齐全，星标「青禾科技」置顶；青禾横向节点 = 已投递 → 一面·已面 → 二面·待面试；二面「周五 15:00」为 `STRONG` + 650 加粗，一面「周二 14:00」降为 400 中性灰可回看；仅链接样本（jobs.example.com/p/42）可识别、可打开；页面与舞台均无横向溢出。
- 1024px 与 820px 中间窗口：样本完整、容器断点收紧后节点仍可读、无溢出、更新入口可见。
- 零数据：切到「空看板 (0)」后桌面 + 两个手机候选同时显示「还没有记录岗位」空态与「添加岗位」入口；返回基线 chip 恢复 4 条。备注：「重置」按钮的语义是恢复**当前选中**数据集（选中空看板后重置仍为空），属 demo 控件语义，不计为缺陷。
- 桌面更新菜单：副标题「当前环节：二面 · 待面试」，`data-target-step-id=qinghe-s3`；提交后回调 `targetStepId=qinghe-s3`，一面未动、二面时间字重降为 400。
- 观察（不计缺陷）：桌面卡待面试时间颜色为正文色 #242424（`.zj-step-time` 覆盖了父级 `.is-pending` 的蓝色）。设计仅要求"整体加粗"，已满足。

## 3.1 手机双历史候选 — 通过

在 320 / 390 / 430px 三档下，两种候选均用同一组 4 份样本渲染，页面无横向溢出，「更新进展」按钮高度 ≥ 44px 触控目标：

- **最新起点（滑动候选）**：初始指示 3/3、下一节点禁用、「回到最新」隐藏、轨道停在末张；当前提示「当前：二面 · 待面试」。
- **回看一面后更新仍指向二面**：滑到 2/3（一面）后打开「更新进展」，菜单副标题与 `data-target-step-id` 仍为二面（qinghe-s3）；提交「标记二面已面」后回调 `targetStepId=qinghe-s3`，一面未被改动，回看位置保留（2/3）。
- **手工选择后返回最新**：2/3 → 1/3 → 点「回到最新」回 3/3；停在历史位置登记新进展（OC）后视图自动跳到 4/4 并提示「当前：OC」。
- **展开候选**：初始显示最新二面待面试；「3 个环节」展开历史，两个面试节点各有独立编辑入口（编辑一面/编辑二面…）；展开状态下更新菜单仍指向二面；收起正常；更新后历史列表当前行高亮。
- 观察：展开式历史列表按从早到晚排列（已投递→一面→二面）。设计所述"两者都从最新进展开始"指卡片默认视图；展开列表的排列方向建议在真机对照（tasks 3.2）时一并确认。

## 边界回归（补充证据）

边界长文本样本（长公司名、长职位、6 轮节点）在 320/390/430 与 1024px 下无溢出；6 轮横滑轨道初始停在最新 6/6；桌面折叠为最近 3 个环节并提供「查看完整历史（共 6 个环节）」入口，展开后 6 节点齐全。

## 复现方式

```bash
npm ci --prefer-offline --registry=https://registry.npmjs.org
npx playwright test -c tests/browser/playwright.config.ts
npx tsx tests/browser/collect-font-evidence.ts   # 1.1 字体实测值
```

原始产物（gitignored）：`test-results/browser/acceptance-report.json`（JSON 报告）、`test-results/browser-artifacts/`（失败截图与 trace，本次无失败）。
