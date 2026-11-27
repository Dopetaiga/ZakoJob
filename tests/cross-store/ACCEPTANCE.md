# persist-job-data 4.1 / 4.2 + present-job-board 4.3 · 双适配器集成验收

2026-11-26 在 Windows 上使用 Edge IndexedDB 和 Miniflare D1 验证同一套存储契约。

## 运行环境

| 项 | 值 |
| --- | --- |
| 系统 / Node | Windows 10.0.26200 x64 · v22.23.2 |
| 浏览器（IndexedDB 腿） | Microsoft Edge 158.0.4370.33（Playwright `channel: "msedge"`，headless） |
| D1（Sites 腿） | Miniflare 4.20260730.0 隔离实例（独立 SQLite），worker/test-entry.ts 测试专用入口经 esbuild 打包注入 |
| 被测适配器 | `createIndexedDbJobBoard`（真实浏览器 IndexedDB）与 `createSitesJobBoard`（src/sites/client.ts → 隔离 D1 Worker HTTP） |
| 运行命令 | `npx tsx --test tests/cross-store/cross-store.test.ts` |
| 结果 | **8/8 通过**，包含两种存储的非空目标恢复检查 |

场景只经由公开 `JobBoardStore` 契约（src/data/contract.ts）编写，两腿共用同一套文件（[scenarios.ts](scenarios.ts)、[fictional-data.ts](fictional-data.ts)），未创建任何重复适配器。Vite 程序 API 专属随机端口、每用例独立数据库/独立 D1 实例，互不污染。

## 4.1 同一组契约场景，两腿共跑 — 通过

8 个场景 × 2 适配器全部一致通过（证据：`test-results/cross-store/scenarios-{idb,d1}-*.json`）：

1. **稳定 ID**：建档采用客户端生成 ID；同 ID 重送被明确拒绝且不覆盖原记录、不追加流程。
2. **星标与资料**：加星/取消跨句柄读回一致；资料补丁「缺省键 = 不变」成立。
3. **日期精度**：仅日期期限保持 `{precision:'date'}`（不补 00:00），精确时刻保留 `time` 字段，跨句柄重读原样。
4. **已挂 / 已拒**：`declinedByUser`（已拒）与 `closedByEmployer`（已挂）独立于流程保存、可相互更正、清除后可继续登记。
5. **撤回与过时撤回**：正常撤回末节点成功；旧客户端以旧版本撤回 → `versionConflict`，重读后二面与三面完整保留；版本正确但末节点 ID 错 → `lastNodeMismatch`。
6. **跨端主动重读**：读端预热后，写端建档/加星/登记，读端主动重读立即看到新数据与推进后的版本。
7. **分端偏好独立与布局继承**：手机覆盖不影响共用与桌面；桌面覆盖不影响手机；新句柄读回完整；恢复沿用共用后桌面覆盖保留；未知模块补丁被拒绝且不写入。
8. **失败反馈**：未知命令种类、非法版本、`nodeNotFound`、对不存在岗位提交 → 全部明确拒绝；读不存在岗位成功且为 null。

**新会话续用（4.1）**：同一浏览器配置新开标签页（新会话）读回上一会话的岗位并成功登记环节（版本 2 → 3）。注意：Playwright 新 context 是隔离存储，不代表「同一站点来源的下一个会话」，故用同 context 新标签页表达新会话。

## 4.2 虚构数据三方往返 — 通过

虚构数据集（3 份岗位：青禾科技二面流程、拾光数据 OC+书面 Offer+已拒、Northstar 笔试+三面；手机与桌面独立布局偏好）：

- **IndexedDB → 另一空 IndexedDB**（`test-results/cross-store/{roundtrip-backup,restore-verification-idb}-*.json`）：导出信封 `zakoujob-backup` v1；3 个岗位 ID、7 个节点 ID 全局唯一；节点种类、轮次、状态、期限精度、已拒结果与分端偏好逐条深度一致。恢复后：清除已拒结果 → 撤回末节点（只剩 OC）→ 同备份再次导入被拒 `targetNotEmpty` 且岗位与偏好均不变。
- **完整三方：IndexedDB → 空 D1 实例 → 另一空 IndexedDB**（`test-results/cross-store/roundtrip-via-d1-*.json`）：D1 空实例导入确认、逐条对齐；非空 D1 重复导入拒绝；从 D1 导出的快照再次通过备份结构核验（稳定 ID 与完整节点穿越 Sites 存储）；末腿 IndexedDB 恢复并完成清结果、撤末步、非空拒绝全部核验。

- 目标只有一份招聘方已结束的岗位时，两种存储均返回 `targetNotEmpty`。导入前后的完整快照一致，包括二面节点、结果和分端偏好。

## 4.3 Sites 保存反馈

- **提交后失联**（worker/test-entry.ts 故障标记 `x-zk-test-fault-drop-response`）：命令已提交但响应被掐断 → 客户端返回 `unconfirmed`（「未确认是否保存」）；正常通道重读可见该命令**恰好落库一次**；同 ID 重送被拒绝，无自动补传、无重复追加。
- **发送前断网**：客户端 `isOffline` 预检 → 未发出请求即按未保存拒绝（契约注释明确该路径，IndexedDB 腿的离线写入已由既有 workspace-browser 用例覆盖）。
- **其他身份**：非所有者读取明确失败（`ok:false`）。
- 站主校验拒绝写入时，Worker 返回 403，客户端显示服务端给出的拒绝原因。断包和未知 5xx 走未确认反馈。

## 资料与期限的清除规则

期限补丁用 `null` 清除期限。资料补丁省略字段会保留原值，传空字符串可清除字段，必须保留一种合法的岗位标识。契约注释与两种适配器一致。[数据契约](../../src/data/contract.ts)

## 已知限制

- 托管实测已核对站主导入、导入后重读、D1 三份分端布局和岗位全量回读。[实施交接单](../../docs/implementation-handoff.md)
- D1 批次故障、导入提交时的并发新增以及恢复期间的快照一致性均有独立回归。[D1 恢复测试](../sites/backup.test.ts)
- Windows 下 Miniflare 对临时目录 `scriptPath` 的模块解析有「can't use .. to break out of starting directory」问题，测试台改用注入打包产物内容的方式规避（见 [d1-harness.ts](d1-harness.ts) 注释）。

## 复现方式

```bash
npm ci --prefer-offline --registry=https://registry.npmjs.org
npx tsx --test tests/cross-store/cross-store.test.ts   # 本验收（8 用例）
npm test                                               # 全仓回归
```

运行证据（gitignored，不入库）：`test-results/cross-store/`（场景结果、备份与结构核验、往返核验 JSON，按运行时间戳命名）。
