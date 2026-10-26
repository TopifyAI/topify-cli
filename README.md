# Topify CLI

Monitor your brand's AI visibility from the command line.

## Install

```bash
npm install -g topify-cli
```

## Quick Start

```bash
# 1. Set your API key (get it at https://app.topify.ai → Management → Members → API Keys)
topify config --api-key tk_live_xxxxxxxxxxxxx

# 2. List your projects
topify projects

# 3. Set a default project so you don't have to pass --project every time
topify config --default-project <project-id>

# 4. Check your brand visibility
topify overview
```

### New user? Create a project from the CLI

If you don't have a project yet, you can create one directly:

```bash
topify projects create --brand "Acme Corp" --website acme.com --webhook https://example.com/hook
```

This kicks off Topify's brand tracking pipeline. You'll receive a webhook notification when setup is complete. Then set it as your default:

```bash
topify config --default-project <project-id>
```

## Commands

### Projects

```bash
topify projects                        # list all projects
topify projects create \
  --brand "Acme" --website acme.com \
  --webhook https://example.com/hook   # create a new project
```

### Overview — visibility summary across all prompts

```bash
topify overview                        # last 7 days
topify overview --days 30              # last 30 days
topify overview --from 2026-03-01 --to 2026-03-15
```

### Competitors

```bash
topify competitors list                # list competitors and metrics
topify competitors list --days 30
topify competitors create "Acme:acme.com" "Globex:globex.net"
topify competitors update <id> --name "New Name" --website new.com
topify competitors delete <id>
```

### Prompts — tracked search queries

```bash
topify prompts list                    # list tracked prompts
topify prompts create --topic-id <id> "best CRM for startups"
topify prompts update <id> --content "new text"
topify prompts delete <id>
```

### Actions — AI-recommended improvements

```bash
topify actions list                    # list action items
topify actions list --status suggested # filter by status
topify actions get <id>                # view action details
topify actions recommend               # trigger new recommendations
topify actions task <task-id>          # check recommendation progress
topify actions accept <id>             # accept an action
topify actions complete <id>           # mark as completed
topify actions ignore <id> --reason "not relevant"
topify actions enrich-content <id>     # generate content edits
topify actions enrich-forum <id>       # generate a forum comment
topify actions execute <id>            # start execution workflow
topify actions respond <id> \
  --workflow-id <wf-id> \
  --decision approve                   # respond to a checkpoint
```

### Webhooks

```bash
topify webhooks list                   # list registered webhooks
topify webhooks create \
  --url https://example.com/hook \
  --events action.checkpoint,action.completed
topify webhooks delete <id>
```

### Other commands

```bash
topify sources                         # domains cited in AI responses
topify topics                          # prompt topic groups
topify trends --days 30                # visibility over time
```

## Actions (agent-friendly)

For coding-agent workflows (e.g. Claude Code), Topify exposes a read surface
that tells the agent exactly what state an action is in and what to do next:

```bash
# What state is this action in? What can I do next?
topify actions state <action-id>

# What named outputs does it have for me to read?
topify actions artifacts <action-id>

# Read one named artifact (research, outline, article, thread, comment, edits)
topify actions artifact <action-id> article
topify actions artifact <action-id> thread --json

# Article publish kit -> drop straight into your static site repo
topify actions artifact <action-id> article \
  --save content/posts/your-slug/index.md
```

The `--save` flag (only meaningful for `name=article`) writes the full markdown
body with a YAML frontmatter block at the top, ready to commit + deploy from
your existing CI. The `schema_jsonld` is printed separately for you to embed
in your page `<head>`.

End-to-end agent flow:

```bash
topify actions list                                 # find actions to work on
topify actions state <id>                           # check state + next steps
topify actions execute <id>                         # start the workflow
topify actions state <id>                           # poll until checkpoint
topify actions artifact <id> research               # review research
topify actions respond <id> --workflow-id <wf> \
                            --decision approve      # approve checkpoint
# ... approve outline ...
topify actions artifact <id> article \
  --save content/posts/<slug>/index.md              # save article
git add . && git commit && git push                 # deploy from your repo
topify actions complete <id>                        # close the loop
```

## Options

All data commands support:
- `-p, --project <id>` — specify project (or use default)
- `-d, --days <n>` — lookback period (default: 7)
- `--from <date>` / `--to <date>` — date range (YYYY-MM-DD)
- `--providers <list>` — filter by provider (chatgpt, perplexity, google_ai_overview)
- `--json` — output raw JSON

## Environment Variable

You can also set your API key via environment variable:

```bash
export TOPIFY_API_KEY=tk_live_xxxxxxxxxxxxx
```

## Use with Claude Code

Add to your project's `CLAUDE.md`:

```markdown
## Topify AI Visibility
Run `topify` commands to check brand visibility in AI search.
API key is configured via `topify config`.
```

Then ask Claude: "Show my brand visibility for the last 30 days"

## API Documentation

https://docs.topify.ai/api-reference/public/introduction

## Data exports and domestic CLI (local release candidate)

Requires Node.js 18+. Existing overseas credentials and project selection still
work. Overseas requests have a 90-second total deadline, including body reads;
set `TOPIFY_TIMEOUT_MS` to a positive millisecond value to change it. Requests
are never automatically retried, especially mutations with an unknown outcome.

```sh
topify export topics --project PROJECT --format json --output topics.json
topify export prompts --project PROJECT --topic-id TOPIC --days 30 --format csv --output prompts.csv
topify export sources --project PROJECT --from 2026-10-01 --to 2026-10-25 --output sources.json
```

Topic exports include related prompts. Source exports fetch all pages, up to
10,000 rows, and fail on repeated pages. Existing files are preserved unless
`--force` is supplied. CSV cells containing strings that could execute as
spreadsheet formulas are escaped. JSON preserves the original field types.
Overseas pagination has no server snapshot token: an export is not a guaranteed
transactional snapshot if the underlying data changes while it is running.
`prompts list --page N --page-size N` remains supported with client-side paging.
Without these options, all returned prompts remain available in JSON.

Domestic data uses the **customer dashboard BFF**, independently of the overseas
API. Sign in to `https://dashboard.topify.ai`, use browser developer tools to
copy the authenticated request's Cookie header value into a private local file,
and set its permissions to owner-only. Do not share this file or paste it into
chat. No dashboard service secret or database credentials belong on employee
machines. This first version uses an existing browser session; it does not yet
implement a dedicated CLI login flow.

```sh
export TOPIFY_CN_COOKIE_FILE=/absolute/private/path/dashboard-cookie.txt
topify domestic companies
topify domestic overview --company COMPANY --from 2026-10-01 --to 2026-10-25
topify domestic responses --company COMPANY --provider doubao --all --output replies.json
topify domestic sources --company COMPANY --all --format csv --output sources.csv
```

Supported reads: companies, filters, overview, trend, competitors, providers,
prompts, responses, sources, accuracy, reports. `--all` supports prompts,
responses and sources; it rejects changed snapshot/revision metadata, repeated
pages and more than 100 pages. Permissions are those of the signed-in employee.
401 or a login redirect requires a refreshed session. `TOPIFY_CN_BASE` may
select an authorized dashboard origin; HTTP is allowed only on localhost.
Domestic calls have a 30-second deadline and do not retry. These commands never
send the overseas key to the domestic endpoint or the domestic cookie overseas.

## Employee Reddit Skill

The standalone Skill is retained in the source repository at `skills/topify-reddit/`; it is pending business confirmation and is not shipped in this npm release. It needs only Node.js 18+,
not this CLI's dependencies. Distribution and installation are separate from
backend deployment; this release candidate has not been installed on employees'
machines. Copy the entire folder into the employee's configured Codex skill
folder when installation is authorized. Invoke `$topify-reddit` with a subreddit
and search request. The included `SKILL.md` explains source selection and limits.

```sh
node skills/topify-reddit/scripts/reddit.cjs --subreddit robotics --source arcticshift --limit 1
```

`selena` matches the checked-in `selena-writer` top/week search. The current
live Selena installation has not been confirmed. Reddit returned HTTP 403 in
this environment; a one-post ArcticShift query succeeded, while larger queries
also returned 422. Source changes require an explicit choice. Archived posts
can be removed from Reddit; the result never claims complete or live coverage.
See [ArcticShift API documentation](https://github.com/ArthurHeitmann/arctic_shift/blob/master/api/README.md).

Run local HTTP contract tests with `npm test`. These tests do not use production
credentials or databases.

## 业务部门数据读取（国内／国外）

这些命令是本地源码新增能力；未发布 npm 新版本。先在本目录执行 `npm ci`，再用
`node bin/topify.js` 代替下面的 `topify`，或在本地通过 `npm link` 安装。

### 国内客户看板

使用本人登录国内看板的 Cookie header 文件：`TOPIFY_CN_COOKIE_FILE=/绝对路径/cn-cookie.txt`。
文件仅保存 header 值，建议权限 `chmod 600`；不要把 Cookie 发到聊天或提交 Git。
默认地址是 `https://dashboard.topify.ai`，可用 `TOPIFY_CN_BASE` 指定同一部署的 HTTPS origin。

```bash
topify domestic session
topify domestic companies
topify domestic overview --company COMPANY --from 2026-10-01 --to 2026-10-25
topify domestic responses --company COMPANY --from 2026-10-01 --to 2026-10-25 --all -o replies.json
topify domestic response-detail --company COMPANY --id RESPONSE_ID
topify domestic prompt-detail --company COMPANY --id PROMPT_KEY
topify domestic accuracy-details --company COMPANY --verdict error --all --format csv -o errors.csv
```

还支持 filters、trend、competitors、providers、prompts、sources、accuracy、reports、me。
提示词详情使用后端现有默认时间范围，详情命令不假装支持日期筛选。回复详情先用列表拿 ID。
`--all` 支持 prompts/responses/sources/accuracy-details；最多 100 页，重复页或可见版本元数据变化会报错，
不落部分导出文件。accuracy-details 后端无快照版本，不能保证跨页期间同数量内容更新被发现；
需要一致导出时使用已稳定的历史范围。页面自身关闭的 PDF 导出仍关闭，不从 CLI 绕过。

### 国外 API Key 数据

原有 API Key 配置不变。新统一入口保留完整 JSON 响应，所有命令支持 `--format csv -o FILE`：

```bash
topify data prompts --project PROJECT --days 7
topify data prompt-chats --project PROJECT --id PROMPT_ID --days 7 --providers openai
topify data source-detail --project PROJECT --domain example.com --days 30 --page 1
topify data source-chats --project PROJECT --domain example.com --days 7 --page 1
topify data recordings --project PROJECT
topify data action-artifact --project PROJECT --id ACTION_ID --name article
topify report --project PROJECT --days 30 -o report.html
```

`topify data --help` 列出全部资源，包括提示词详情/分析/竞品/引用域名/URL、来源分析、趋势、
actions 状态/产物/任务/废弃修改。分页接口通过 `--page`、`--page-size` 显式翻页；
不能把单页输出当全量。原有 `export sources` 提供带重复页检查的全量来源导出。
报告下载超时可以设置 `TOPIFY_TIMEOUT_MS=150000`，超时不会保存半份文件或自动重复请求。

### 国外页面独有数据

国外网站中部分数据没有对应的 API Key 接口。`web-data` 调用页面自身的已认证查询接口，
使用单独的 `TOPIFY_WEB_COOKIE_FILE`，默认 `https://app.topify.ai`，不复用国内 Cookie。
服务端仍负责用户、团队和项目授权；不会使用 service-role 或数据库密钥。

```bash
topify web-data competitors-detail-summary --project PROJECT --competitor COMPETITOR --days 7
topify web-data prompt-outputs --project PROJECT --id OUTPUT_ID
topify web-data prompt-domains-citations --project PROJECT --id PROMPT_ID --domain example.com --days 7
topify web-data seo-gsc-queries --project PROJECT --days 30
topify web-data prompts-fanouts-insights --project PROJECT --days 7
topify web-data heatmap-topic --project PROJECT --id TOPIC_ID --from 2026-10-01 --to 2026-10-25
```

`topify web-data --help` 列出 55 个经过源码对照的页面查询入口。部分查询使用 POST，但它们的
用途是读取分析结果，不是修改业务数据。历史指标回填接口 competitors-metrics-history 不在只读清单中。需要额外筛选项时，`--filters-file filters.json` 接受页面查询
JSON；用户/团队/租户身份字段不可注入，项目由 `--project` 指定。页面未开放或账号无权访问的内容
仍会被服务端拒绝。此入口不开放 API 密钥管理、后台内部数据、计费操作或修改配置。

JSON 输出完整保留响应层级和分页元数据；CSV 将嵌套对象保存为 JSON 单元格，防止公式执行。
所有文件默认不覆盖已有文件；明确使用 `--force` 才替换。Cookie 过期返回错误，需要重新登录更新文件。

### 国外业务人员常用只读流程

使用本人会话文件（权限 0600），不要分发会话或团队密钥。此 CLI 不自动提取浏览器凭据：

```bash
export TOPIFY_WEB_COOKIE_FILE=/private/path/my-topify-cookie.txt
topify web-data overview-visibility --project PROJECT --days 7 -o visibility.json
topify web-data overview-analysis-prompt --project PROJECT --days 7 --rows data.items --format csv -o prompts.csv
topify web-data sources-list --project PROJECT --days 7 --page 1 --page-size 20 --rows data.domain_table.items --format csv -o sources-page-1.csv
topify web-data sources-detail-summary --project PROJECT --domain www.example.com --days 7
topify web-data prompt-chats --project PROJECT --id PROMPT_ID --days 7 --page 1 --page-size 20
```

`--rows` 明确选取响应中的数组，便于得到一行一条业务记录的 CSV；没有此参数时保留完整响应。
它不会自动翻页，取数组后也不包含分页元数据；全量任务应先读取完整响应总数，再逐页获取。
`prompt-list` 默认 `ord=desc, lightweight=true` 读取提示词目录；统计指标用 `overview-analysis-prompt`。
来源和竞品详情会把 `--days/--from/--to` 映射到 `date_range`，来源模型筛选映射到 `models`。
日期必须成对且为有效 YYYY-MM-DD；页数必须为正整数。prompt-chats 默认每页20条。
fanouts-prompts 需要 filters-file 中的 fanout_query；单条竞品答案需要 answer_id，来源关联提示词需要 canonical_url。
prompt-answers-export 使用 filters-file 指定 prompt_ids、offset、limit，分批读取答案正文。
热力图默认 metric=visibility，可用 filters-file 指定其他页面支持的指标。
服务端 4xx/5xx、HTTP 200 中的应用错误码、超时都以非零退出，不生成成功导出，也不自动重试。
未连接 GSC 时接口可能返回 connected=false 和空 rows：这表示未连接，不能报告为“流量为零”。

2026-10-26 当前账号实测发现旧版 overview-sources 返回504，应优先使用页面当前的 sources-list。
其他具体线上结果与限制见交付包《国外CLI线上验收.txt》；不能把本地契约测试或空数据响应当作所有功能线上通过。

### 国内报告工具（tool.topify.ai）

`topify tool` 与 `topify domestic` 是两套独立入口。前者读取报告工具，后者读取客户看板。
报告工具使用 `TOPIFY_TOOL_INVITATION_FILE` 指向本人已有邀请码文件（建议权限 0600），
不使用客户看板 Cookie、国外 API Key、管理员令牌，也不会自动提取浏览器登录信息。
邀请码通过请求头传输，不进入 URL 或命令参数。不要把全局邀请码分发给普通员工：
全局邀请码按现有系统规则能查看全部历史；普通邀请码仅能读取直接所属或明确关联公司的报告。

**新入口需要后端先部署 `/api/employee/reports`；本次仅交付代码，未部署。**
若服务器尚不支持，CLI 报错退出，不回退到旧版仅凭报告 ID 的详情接口。
本次新增的服务端入口独立校验每次请求，旧页面路由没有改动；旧接口的权限问题并未因此消失。

```bash
export TOPIFY_TOOL_INVITATION_FILE=/absolute/path/to/my-invitation.txt
topify tool history --all -o reports.json
topify tool history --search 金风 --format csv -o reports.csv
topify tool history --brand 金风 --page 1 --page-size 20
topify tool brands
topify tool summary --id REPORT_ID
topify tool prompts --id REPORT_ID
topify tool responses --id REPORT_ID --prompt-index 0
topify tool details --id REPORT_ID --include-responses -o report-data.json
topify tool sources --id REPORT_ID
topify tool article-hits --id REPORT_ID
```

这 8 个只读命令覆盖报告历史、品牌分组、概览、提示词、完整回复和引用、详情、来源排名与文章命中。
业务数据包含页面原有的可见性、排名、情绪、竞品与事实核验指标（存在时）。
不开放调度配置、采集凭据、数据库、账号管理或文章发布操作；PDF/XLSX 原生下载和管理页数据未纳入这 8 个命令。
`brands` 是最多 1000 条近期报告形成的分组，不代表全部历史品牌。
`history --all` 最多读取 100 页，发现总量变化、重复 ID 或条数不符时不写出部分文件。
后端没有快照版本，故不能保证导出期间发生的原地更新被检测到；历史导出也不是事务快照。
JSON 保留结构；历史 CSV 每条报告一行；嵌套数据使用 JSON 单元格。

本地实测包含真实 CLI → 本机 HTTP → FastAPI → 隔离 SQLite，以及跨邀请码拒绝、
公司关联撤销、邀请码停用、禁止管理员凭据混用、无写入检查。
这些不等于生产逐页验收；上线仍需按批准流程部署后用本人凭据核对。

### 无需手写 JSON 的查询选项

`topify web-resources` 或 `topify web-resources prompt-answers-export` 可在不登录的情况下查看只读入口及参数映射。
常用下钻和答案导出可直接用参数；参数仅在对应入口有效，冲突或不支持时在请求前报错：

```bash
topify web-data prompt-answers-export --project PROJECT --prompt-ids PROMPT1,PROMPT2 --days 7 --offset 0 --limit 50 -o answers-page-1.json
topify web-data competitors-detail-answer --project PROJECT --competitor COMPETITOR --answer ANSWER_ID --days 7
topify web-data competitors-detail-owned-source-prompts --project PROJECT --competitor COMPETITOR --url CANONICAL_URL --days 7
topify web-data prompts-fanouts-prompts --project PROJECT --fanout-query 'query from the fanout list' --days 7
```

答案分批结果的 `has_more`、`next_offset` 用于继续读取下一批；单批不等于全量。
`--timeout 120` 设置包含响应正文读取的总超时（最多300秒），超时不会自动重试。
上游5xx会附上该入口的排查建议，仍以失败退出，不静默换接口或伪造空结果。
若GSC等数据源明确 `connected=false`，读取完整JSON可看到状态；`--rows` 则失败且不保存空表，避免误认业务数据为零。
这些设计改动通过本地命令集成回归；前轮线上测试覆盖与限制仍以验收报告为准，没有把本轮本地测试改称线上复测。

### 0.6.0：沿用 API Key 正式入口

正式员工流程沿用 `npm install -g topify-cli` 和本人获准使用的 API Key。
`web-data` 仅为研发验证/手动会话高级入口，不作为员工正式接入方式；其55项页面查询不代表Public API已覆盖55项。
Selena skill保持独立交付，未加入本次npm文件清单。

```bash
# 已有生产Public API，无需新增后端即可使用
# TOPIFY_API_KEY 使用团队授权给你的凭据；不要借用其他同事或管理员凭据。
topify data projects
topify export prompts --project PROJECT --days 7 --format csv -o prompts.csv
# 以下两个新资源需先部署对应Customer API后端；旧服务会明确返回404。
topify data output --project PROJECT --id ANSWER_ID -o answer.json
topify data outputs --project PROJECT --prompt-ids PROMPT1,PROMPT2 --days 7 --offset 0 --limit 50 -o answers-page-1.json
```

新答案接口按Key所属团队检查项目，再检查答案/提示词所属项目，仅输出答案正文、模型、品牌情绪和业务引用。
它沿用现有团队API Key授权语义，不声称团队Key等同于个人网页权限。分批最多100条，按时间和ID稳定排序；并发数据变化时offset分页不是事务快照。
`--days` 必须大于0，或提供完整日期范围；新接口不把0伪装成全量。根据 `has_more` 和 `next_offset` 读取下一批。
发布顺序：必要的Customer API更新先部署并验收，再发布npm新版本；现有接口命令保持兼容。
