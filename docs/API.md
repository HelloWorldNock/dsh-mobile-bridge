# HTTP / SSE 契约（R24）

> 这份文档是两端唯一的接口依据。改 `host/lib/server.js` 的路由或字段时同步改这里；
> `README.md` 只保留摘要并指向本文。
> 实测基准：0.9.0，`host` 19→21 个模块、122 个用例。

## 1. 传输与鉴权分层

| 层 | 凭据 | 适用范围 | 失败码 |
|---|---|---|---|
| 公开 | 无 | `/health`、`/api/discovery`、`POST /api/pair`、`POST /api/group/join` | 各自限流/一次性约束 |
| loopback | 无（仅 127.0.0.1/::1） | `/api/setup/*`，写操作还要 `x-dsh-csrf` | `setup/forbidden` 403、`setup/csrf` 403 |
| 设备 | `Authorization: Bearer dshm_...` | 其余全部内容接口 | `auth/unauthorized` 401 |
| 绑定组 | `Authorization: Bearer dshg_...` | `POST /api/group/hello` + 组内协作内容接口；**读不到** `/api/events`、`/api/logs` | 401 / `auth/forbidden` 403 |

- 设备 token 与组密钥互不替代：`/api/group/hello` 只认组密钥，设备 token 打过去是 401。
- 手机侧 token 由 `POST /api/pair` 用 6 位配对码换取；服务端只存 SHA-256，撤销后立即失效。

## 2. 通用约定

- 请求体 JSON，UTF-8；上限 32 MiB（`request/too-large` 413）。
- 错误体固定 `{"error":{"code":"...","message":"..."}}`。
- CORS 只放行本机面板来源（`dsh-app://*`、`http://127.0.0.1|localhost`）。
- 时间统一毫秒数（`updatedAt`）；文件名型字段自行做 URL 编码。

## 3. 路由表

### 3.1 公开

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | `{ok,version,deviceId}` |
| GET | `/api/discovery` | 与 UDP 发现应答同内容，供 NAT 中继查询 |
| POST | `/api/pair` | `{code, installId?, deviceName?, model?, appVersion?}` → `{token, deviceId, ...}` |
| POST | `/api/group/join` | `{code, baseUrl, deviceId, name?, version?, collabRoot?, collabWorkspaceId?}` → 组密钥 |

### 3.2 面板（loopback + CSRF）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/setup/state` | 面板状态：`code`/`devices`/`settings`/`compatibility`/`logs`/`workspaces` 等 |
| GET / POST | `/api/setup/tailscale` | 内嵌节点状态 / 启停与 auth key |
| GET | `/api/setup/logs` | 导出的 `.log`（`?lines=`） |
| POST | `/api/setup/code` | 空 body → 轮换配对码 |
| POST | `/api/setup/revoke` | `{deviceId}` 撤销单台设备 |
| POST | `/api/setup/settings` | 设置项：`phoneFirst` / `discovery` / `approvalTimeoutMs` / `questionTimeoutMs` / `planReviewTimeoutMs` / `collabRoot` / `collabWorkspaceId` / `workspaceRoot` |
| POST | `/api/setup/group` | `{action, baseUrl?, selfBaseUrl?, code?, deviceId?}`；`action` ∈ `create` / `invite` / `join` / `leave` / `forget`；`join` 的 `selfBaseUrl` 同 `/api/group/link` |
| POST | `/api/setup/reset` | 重置：撤销全部设备并轮换配对码 |
| POST | `/api/setup/update` | `{force?:boolean}`（`true` 时忽略缓存/节流立即重查）→ `{ok, update}` |

### 3.3 内容（设备 token 或组密钥）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/info` | 桥接版本、端点、设备、公开设置 |
| GET | `/api/logs` | 手机端导出运行日志（peer 403） |
| GET | `/api/workspaces` | `{root, workspaces:[{id,path,title,updatedAt,sessionIds}], archivedSessionIds}` |
| POST | `/api/workspaces` | `{name}` 在默认根目录下建子目录并登记 |
| GET | `/api/permission-presets` | `{options:[{value,name,description}], defaultPreset}` |
| GET | `/api/sessions?q=` | `{sessions:[...]}`（归档与不可见会话已过滤） |
| POST | `/api/sessions` | 见 §4.2 |
| GET | `/api/sessions/:id` | `{session, records, pending}` |
| DELETE | `/api/sessions/:id` | 删日志目录；运行中 409，仍驻留内存 409 |
| POST | `/api/sessions/:id/archive` \| `/unarchive` | 与桌面端共用归档集合；运行中 409 |
| GET | `/api/sessions/:id/history?beforeSeq&maxMessages` | 分页历史 |
| GET | `/api/sessions/:id/images/:seq/:index` | 历史图片原始字节 |
| POST | `/api/sessions/:id/prompt` | `{text, images?}` · `session/prompt-failed` |
| POST | `/api/sessions/:id/cancel` | 空 body |
| POST | `/api/sessions/:id/rename` | `{title}` |
| POST | `/api/sessions/:id/permission` | **`{preset:string}`**（取值见 `/api/permission-presets`：`read-only` / `workspace-write` / `danger-full-access` / `auto`）→ `{current}`；写 `{value}` 会得到 `permission/bad-request` 400「缺少 preset」 |
| POST | `/api/sessions/:id/plan` | **`{active:boolean}`**（不是 `{plan:true}`；用错字段返回 `plan/bad-request` 400「active 必须是布尔值」）→ `{active,status}` |
| POST | `/api/subscribe` \| `/api/unsubscribe` | `{sessionId}` 订阅流 |
| GET | `/api/pending` | `{approvals:[...], questions:[...]}` |
| POST | `/api/approvals/:id` | `{action:'allow-once'\|'allow-always'\|'reject'}` |
| POST | `/api/questions/:id` | `{answers:[{id,selected:[],custom?}]}` |
| GET | `/api/events` | SSE（Bearer 设备 token；peer 403） |
| GET | `/api/group` | 组状态 + `collabRoot` |
| POST | `/api/group/invite` | 空 body → 一次性邀请码 |
| POST | `/api/group/link` | **`{peerBaseUrl, code, selfBaseUrl?}`**：本机主动去加入对方；`selfBaseUrl` 是本机希望对方回连的地址（不传则用探测到的局域网地址） |
| GET | `/api/collab/files?cwd&since` | 协作工作区文件清单（≤200 项） |
| GET | `/api/collab/file?cwd&path=` | 单文件（只读协作工作区内） |

## 4. 关键形状

### 4.1 会话摘要

```json
{ "id":"session-…", "title":"…", "cwd":"F:\\work", "running":false,
  "agentAvailable":true, "updatedAt":1700000000000,
  "plan":{"active":false,"pending":false}, "permissions":{"currentValue":"workspace-write"} }
```

### 4.2 `POST /api/sessions`

请求（三选一决定建新还是续跑）：

```json
{ "workspaceId":"ws_1"            // 或 "cwd":"F:\\work"，或 "sessionId":"session-…" 续跑
  ,"prompt":"…"                    // ≤20000 字；可与 images 同时省略（空会话）
  ,"mode":"queue"                  // "queue" | "steer"
  ,"permission":"workspace-write"  // 可选，失败只进 warnings
  ,"plan":true                     // 可选
  ,"images":[{"data":"<base64>","mediaType":"image/png"}]
  ,"agentPreset":"…" ,"clientTimeZone":"Asia/Shanghai" }
```

响应：`{sessionId, agentPreset, resumed, warnings[]}`。
prompt 派发失败会清掉刚建的空会话并返回 `session/prompt-failed`（`sessionId` 留在 message 里）。

### 4.3 待办

```json
{ "approvals":[{"id":"ap_…","sessionId":"session-…","toolName":"bash","preview":"…"}],
  "questions":[{"id":"q_…","questions":[{"id":"q1","title":"…","options":[…],"multi":false}],"planReview":false}] }
```

## 5. SSE

`GET /api/events`，`text/event-stream`；心跳为注释行，20 s 一次（手机端 75 s 无数据即判死）。

| 事件 | 载荷 |
|---|---|
| `hello` | `{deviceId,hostName,clients,version}` |
| `session.added` / `session.updated` | `{session}` |
| `session.status` | `{sessionId,running,session?}` |
| `session.activity` | `{sessionId,updatedAt}` |
| `session.snapshot` | `{sessionId,records:[]}` |
| `session.event` | `{sessionId,item}` |
| `assistant.delta` | `{sessionId,item:{phase,kind,text,index}}` |
| `session.removed` | `{sessionId,archived?}` |
| `session.error` | `{sessionId,message}` |
| `approval.requested` / `question.requested` | 单张卡片 |
| `approval.closed` / `question.closed` | `{id,outcome,reason,answeredBy,sessionId}` |
| `notice` | `{kind:'turn-end'\|'turn-error'\|'attention',…}` |

## 6. 错误码

| 前缀 | 码 |
|---|---|
| `auth/` | `unauthorized`(401) `forbidden`(403) |
| `pair/` | `bad-code`(400) `expired`(410) `locked`(429) `rate-limited`(429) |
| `session/` | `bad-request`(400) `bad-title`(400) `not-found`(404) `active`(409) `loaded`(409) `not-live` `prompt-failed`(500) `archive-failed`(500) `archive-unavailable`(501) |
| `prompt/` | `empty`(400) `too-long`(400) `too-many-images`(400) `image-invalid`(400) `image-too-large`(413) |
| `workspace/` | `bad-name`(400) `exists`(409) `create-failed`(409) `unavailable`(503) |
| `permission/` | `bad-request`(400) `unknown`(400) `unavailable`(501) |
| `plan/` | `bad-request`(400) `unavailable`(501) |
| `group/` | `unavailable`(503) `not-ready`(503) `bad-invite`(400) `invite-expired`(410) `invite-locked`(429) `rate-limited`(429) `bad-url`(400) `bad-peer`(400) `unreachable` `join-failed` |
| `collab/` | `no-group`(400) `unknown-peer`(404) `not-found`(404) `forbidden`(403) `bad-request`(400) `too-large`(413) `unavailable`(503) `unreachable` `peer-error` |
| `setup/` | `forbidden`(403) `csrf`(403) `bad-request`(400) `bad-root`(400) `bad-workspace`(400) `not-found`(404) |
| 其他 | `request/bad-json` `request/too-large`(413) `method/not-allowed`(405) `not-found`(404) `image/not-found`(404) `image/unavailable`(404\|503) `subscribe/bad-request` `update/unavailable` `tailscale/unavailable`(503) |

手机端按 `code` 分支，不解析 message；message 只用于展示。

## 7. 宿主兼容（适配层）

`host/lib/adapters/dsh/` 收口宿主差异，server/events 不再直接摸 `ctx.*`：

- `session-adapter`：`list()` 归一化 `{items}` 与裸数组；`cancel`/`rename` 的对象参数形状集中在这里；缺方法抛 `adapter/unsupported`。
- `workspace-adapter`：`list()` 读不到给 `[]`；`resolveByPath()` 统一 `await`（0.2.x 是 async，0.1.x 是同步）；`archivedIds()` / `archivedIdsOrNull()` 区分「没有归档」与「读不到」；写操作异常原样上抛，由 server 映射 409/404。
- 启动探针 `lib/compatibility-check.js` 把同一批能力检查结果写日志并下发面板（`/api/setup/state.compatibility`）。

## 8. 变更策略

1. 新增路由：先写 `host/test/*.test.js` 的鉴权与形状用例，再实现，再更新本文与 README 摘要。
2. 改字段：只允许**新增**可选字段；删改字段要同时改 `docs/RELEASE-*.md` 的「升级注意」。
3. 错误码只增不改；语义变化必须换新码。
4. 每次发版前 `node tools/verify-package.mjs` + `node --test` 必须绿。
