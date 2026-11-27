# 回归 · 相邻双面试完整时间文本的横向时间线渲染

2026-11-26 在未修复基线上用真实 Edge + 真实 IndexedDB + 正式 UI（`createJobBoardApp`）复现并锁定缺陷。**只提交测试；产品修复由 Gemini 负责。**

## 运行环境与基线

| 项 | 值 |
| --- | --- |
| 系统 / Node | Windows 10.0.26200 x64 · v22.23.2 |
| 浏览器 | Microsoft Edge 158.0.4370.33（Playwright `channel: "msedge"`，headless） |
| 基线 | `qa/board-acceptance` @ `4a92802`（`git merge --ff-only main` 后确认包含 `4a92802`，工作区无其它改动） |
| 数据注入 | 经公开 `JobBoardStore` 契约（`create-job` / `log-step` / `update-step`）写入真实 IndexedDB（每次用例独立数据库），再挂载正式 UI 渲染 |
| 数据集 | 一个岗位：已投递 → 一面（已面，`datetime` 今天−4 天 10:30）→ 二面（待面试，`datetime` 今天+5 天 15:00）。两个相邻面试均渲染完整「M月D日 周X HH:mm」（用例 D 断言文本逐字完整，全部视口通过） |
| 运行命令 | `npx playwright test -c tests/regression-timeline/playwright.config.ts` |

测量方式：`Range.getClientRects` 取每个步骤标题/时间的**实际绘制边界**（非布局盒，也非页面/父容器溢出断言），对照相邻步骤同排文本与 `.zj-timeline-wrap` 可视边界。日期相对运行日推算并从测试进程注入测试台，保证任何日期运行都能重复。

## 未修复基线结果：13 用例 12 失败 1 通过

证据（gitignored）：`test-results/regression-timeline/probe-*.json`（各视口实测数值）、`tests/regression-timeline/test-results/regression-timeline-artifacts/`（失败截图与 trace）、`test-results/regression-timeline/report.json`。

### A · 相邻步骤文本绘制边界相撞（设计要求：完整可读）

一面时间的绘制右缘压过二面时间的绘制左缘（gap < 0 即像素相交）：

| 视口 | 一面「11月22日 周日 10:30」右缘 → 二面「12月1日 周二 15:00」左缘 | 结论 |
| --- | --- | --- |
| mobile 320 / 390 / 430px | 间距 **−18.73px**（重叠加压） | 失败 |
| desktop 1024px | 间距 **−0.34px**（相触） | 失败 |
| desktop 1280px | 间距 +19.34px | 通过（缺陷随列宽变化，1280 列宽 122px 时恰好放得下） |

根因：`.zj-step` 固定列宽（基础规则 `clamp(86px, 10vw, 122px)`：实测手机端一律取下限 86px，desktop 1024px 为 102.4px，desktop 1280px 触顶 122px；列间距 14px），而 `.zj-step-title` / `.zj-step-time` 为 `white-space: nowrap`。完整时间文本实测宽 116.7px（已面 12px）/ 142.7px（待面试 15px/650），远超列宽，越界绘制到相邻列的文本上。

### B · 当前（最新）节点时间被可视边界裁切且不可达

`.zj-timeline-wrap` 为 `overflow-x: auto; direction: rtl`（注释：滚动原点固定在最新右端）。末节点为当前节点，其 nowrap 时间文本向右越出可视右缘；rtl 滚动容器起始侧越界内容**无法通过滚动到达**，属永久裁切：

| 视口 | 当前节点「12月1日 周二 15:00」右缘超出可视右缘 | 结论 |
| --- | --- | --- |
| desktop 1280px | **+16.66px** | 失败 |
| desktop 1024px | **+35.77px** | 失败 |
| mobile 320 / 390 / 430px | **+52.66px** | 失败 |

其中 mobile 320px 内容溢出可视区（scrollWidth 290 > clientWidth 256），即使滑到最左再滑回，可滚动范围只能再露出 34px，仍有 **18.73px** 时间文本永远不可见（390/430px 列盒恰好放得下、无可滚动余量，越界文本同样整段不可达）。

### C · 窄屏「滑到最早回看 → 滑回最新」后当前节点仍不完整

320/390/430px 三个视口全部失败：滑回滚动原点（最新端）后，当前节点时间文本绘制右缘仍超出可视右缘 52.66px。320px 用例先验证了滑动真实发生（`scrollLeft` −34 → 0），失败点在滑回后的完整性断言。

### D · 完整时间文本渲染（对照项，全部通过）

两个面试节点时间文本逐字等于「M月D日 周X HH:mm」（月/日不补零、星期由日期推得、待面试为 strong 650 强调、已面为 is-past 弱化）——缺陷与时间文本精度无关，纯粹是布局问题。

## 缺陷归纳

1. 完整「月/日 + 星期 + 时分」时间文本在固定列宽 + nowrap 下的**越界绘制**：与相邻步骤文本像素级相撞（手机端叠加 18.73px）。
2. 横向时间线在 rtl 滚动容器起始侧的**不可达裁切**：当前节点（最新进展）的完整时间在桌面 1280/1024 与手机 320/390/430 全部被裁且无法滑出查看，直接违背「打开卡片从最新进展往回看」「窄屏可回看当前节点」的要求。

## 复现方式

```bash
npm ci --prefer-offline --registry=https://registry.npmjs.org
npx playwright test -c tests/regression-timeline/playwright.config.ts   # 本回归（13 用例）
```

未修改任何共享配置与生产源码；新增文件全部在 `tests/regression-timeline/`（测试台、探针、用例、本报告）。`npm run typecheck` 通过，`npm test`（`*.test.ts` glob）不受影响。
