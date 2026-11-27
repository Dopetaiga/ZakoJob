# ZakoJob

ZakoJob（扎口Job）是个人手填的求职看板。可以先收藏一个招聘链接，收到通知后再登记笔试、任意轮次的面试、OC 或书面 Offer。手机和桌面使用同一套岗位动作。

用「日历」查看某天的面试、笔试截止和 Offer 答复，用「时间线」沿同一日期轴比较多份岗位。点击一条安排可返回来源节点。卡片改期或撤回后，本页的日程随保存结果更新。宽桌面将月历放在岗位列表右侧，手机和中等宽度窗口可从导航打开日历。

提供两种运行方式：本地版把岗位和布局保存在当前浏览器的 IndexedDB，无需任何后端；私有 Site 版通过同源站点 API 使用本实例的 D1，手机和电脑登录同一站主账户即可跟进同一份申请。

## 安装这个项目

需要 Node.js 22.12 或以上版本。把下面的调用例交给能操作本机的 agent（Codex、T3 Code 等），或按示例自行执行：

> 安装这个项目 https://github.com/Dopetaiga/ZakoJob —— 克隆仓库并进入目录，运行 `npm ci` 完成安装。先用本地版 `npm run dev` 打开终端给出的地址，数据保存在当前浏览器的 IndexedDB。如需手机和电脑同步，再按 README 的「部署到自己的私有 Site」构建并发布，绑定自己的 `OWNER_USER_ID`。

对应的原始命令：

```sh
git clone https://github.com/Dopetaiga/ZakoJob.git
cd ZakoJob
npm ci
npm run dev
```

agent 会从 [AGENTS.md](AGENTS.md) 发现项目入口、设计基底与提案索引，安装与维护任务均可据此推进。

## 本地使用（IndexedDB）

从项目根目录运行以下命令，打开终端给出的本地地址。

```sh
npm ci
npm run dev
```

静态版将岗位和布局保存在当前浏览器、当前站点的 IndexedDB。再次打开时使用同一浏览器和地址。更换浏览器、清理网站数据或迁移到私有 Site 前，可以在设置中导出 JSON 备份。

```sh
npm run build
npm run preview
```

将生成的 `dist/` 放到静态 HTTP 服务即可使用。首次打开是空看板。在 `/demo.html#mobile` 可以用四份虚构样例对照两种手机历史交互，切换卡内菜单和底部面板。点「重置」可重复同一操作。演示页的操作只影响当前页面。

在 `/schedule-demo.html` 可以操作十种虚构日程场景。用 `?scene=same-day-multi&view=calendar` 查看同日的四个安排，用 `?scene=dense-month&view=timeline` 对照多份岗位。场景中的今天固定为 2026 年 11 月 27 日，点击「重置场景」可重做。

## 部署到自己的私有 Site

### 准备与构建

```sh
npm ci
npm run build:sites
```

Sites 构建包含 `dist/client/` 的页面资源和 `dist/server/index.js` 的 Worker。

### 新建站点并配置绑定

Sites 工具或 skill 可用时，先用 `create_site` 创建自己的所有者私有 Site，再将平台返回的项目 ID 用 `set-project-id` 写入该部署副本中 `.openai/hosting.json` 的 `project_id`。保留 `d1` 绑定名 `DB`，每个实例使用独立的数据库。岗位、偏好和备份由站点 API 读取。

### 推送可部署源码并保存私有版本

本项目的部署以源仓库为准：先把可部署源码推送到该 Site 专属的源仓库，再以返回的提交和归档保存、私有发布。

1. 用 `site-workflow` 连接站点源仓库时，临时凭据一律通过 stdin 传入，不写入命令行参数、文件或任何仓库。
2. 推送可部署源码（含 `drizzle/` 迁移目录）到该 Site 的专属源仓库，记录返回的精确 `commit_sha`，并保存与该提交一致的归档（archive）。
3. 用该 `commit_sha` 与匹配的归档调用 `save_version_and_deploy_private`，保存并私有发布这一版本。
4. 用 `update_environment_variables` 在站点部署环境设置 `OWNER_USER_ID`（见下节），再用 `deploy_private_site_version` 发布刚保存的私有版本。部署状态显示成功即完成。

### D1 迁移

托管迁移按 `drizzle/meta/_journal.json` 依次应用 `drizzle/*.sql`：首次发布建出 `jobs`、`preferences`、`completed_imports` 三张表和防重导触发器，之后仅在新增迁移文件时追加执行。生产 Worker 不内置迁移与测试接口。

手机和电脑登录同一站主账户，打开同一站点即可跟进同一份申请。

### 凭据与站点配置不要回推公共仓库

本仓库是公共分发仓库：部署凭据、站点专属源仓库地址、`project_id`、`OWNER_USER_ID` 和任何临时凭据都只属于各使用者的部署副本，不得提交或推送回本仓库。仓库内的 `.openai/hosting.json` 只包含绑定名（`{"d1":"DB","r2":null}`），不含项目 ID；`.gitignore` 已排除 `.dev.vars`、`.env` 等本地配置。

### 配置 OWNER_USER_ID 并完成首次验证

站主在受信任的部署配置中为每个新站设置 `OWNER_USER_ID`（即上节 `update_environment_variables` 写入的部署环境变量），值为本人（站主）在该 Site 内的站点作用域访问者 ID。部署平台以可信头 `oai-authenticated-user-id` 注入访问者身份，服务端将两者核对后才放行数据接口。

先使用站主账号登录自己的 Site，再打开下列地址。

```
https://<你的站点域名>/api/session
```

页面返回 `{"userId":"…"}`。把该值填入站点部署环境的 `OWNER_USER_ID`，重新部署同一版本。用已登录的站主账号打开 `/api/board/jobs`，空看板会返回 `{"jobs":[]}`。然后在手机添加一份仅有链接的测试岗位并加星，桌面打开同一地址补充资料、登记二面，手机刷新后应读到同一岗位和时间。

在无痕窗口打开私有站会先看到平台登录页。进入 Worker 的业务请求须通过站主校验。Worker 在未配置所有者、缺少身份、身份不符时分别返回 503、401、403。

### 后续同站更新

修改代码后在同一部署副本重新 `npm run build:sites`，推送新的可部署源码到同一 Site 的专属源仓库，以新的 `commit_sha` 与匹配归档重复「保存并私有发布」一节：`save_version_and_deploy_private` → `update_environment_variables`（如环境变量未变可跳过）→ `deploy_private_site_version`。更新已有站继续使用同一 `project_id`，站点地址与数据不变。岗位、偏好与备份保存在该 Site 绑定的 D1 数据库里，重新部署不会清空。发布完成后用手机和桌面分别刷新，确认读回最新页面与既有数据。注意每个实例使用独立数据库：不要把另一实例的 `project_id` 或数据库绑定到同一站点，也不要复用其他站的 `OWNER_USER_ID`。

## 迁移与复测

目标看板中岗位数为零时可以导入备份，包括已配置布局的空看板。导入会同时恢复岗位、共用布局和手机、桌面各自的布局偏好。已挂或已拒的岗位也计入目标看板的岗位数。

```sh
npm run typecheck
npm test
npx playwright test -c tests/data/browser/playwright.config.ts
npx playwright test -c tests/browser/playwright.config.ts
openspec list --json
openspec validate --all --strict
```

浏览器用例使用本机安装的 Microsoft Edge（Playwright 的 `msedge` 渠道），D1 测试使用独立的本地 Miniflare 实例。iOS 与 Android 真机应分别记录设备、浏览器、斜滑与列表位置、菜单与软键盘、从系统主屏幕图标启动的结果。[实施交接单](docs/implementation-handoff.md)

## 许可说明

- 本仓库未附带开源许可证文件，`package.json` 亦未声明 `license`：默认保留所有权利。公开或再分发前，请仓库所有者自行选择并添加许可证。
- 字体 MiSans 通过 npm 依赖 `misans@5.0.0` 载入，版权归小米所有，使用条件见[小米官方说明](https://hyperos.mi.com/font/faq)；应用内在「设置 → 关于 · 字体署名」保留署名。仓库不打包字体文件，文档仅引用官方维护者的 CSS 入口。
- 界面图标、看板视觉与文档为本项目原创。
