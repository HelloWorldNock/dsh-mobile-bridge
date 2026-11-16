# 安全模型与协作组角色（R17 设计）

> 状态：设计已定，最小实现按下面的「落地顺序」推进。
> 相关代码：`host/lib/auth.js`（设备 token）、`host/lib/group.js`（组密钥/握手）、`host/lib/server.js`（`requireAuth` / `requireIdentity` / 路由守卫）。

## 1. 现在有什么

| 凭据 | 形式 | 能力 | 撤销 |
|---|---|---|---|
| 配对码 | 6 位数字，120 s TTL，单码 5 次失败，单 IP 10 次/分 | 换设备 token | 自然过期 |
| 设备 token | `dshm_` + 32 字节随机，服务端只存 SHA-256 | 手机端全套内容 API（任务、prompt、审批、协作读写、`/api/events`） | 面板逐个撤销，撤销即失效 |
| 绑定组密钥 | `dshg_` + 32 字节随机，只存 SHA-256 | 组内握手 `/api/group/hello` + 组内协作（可建会话、写 prompt），**读不到 `/api/events` 与 `/api/logs`** | 退出/重建组 |
| 面板会话 | loopback + CSRF | `/api/setup/*` 全部本机设置 | 关掉 DSH |

已知边界（写进 README 的也是这几条）：组密钥是「全权」，任何人都能拿它在这台机器上派活；没有只读身份；没有工作区粒度——拿到组密钥就能看全部工作区。

## 2. 四个角色

| 角色 | 定位 | 允许 | 明确禁止 |
|---|---|---|---|
| **Owner** | 组创建者 / 本机主人 | 组设置（改名、邀请、踢人、配协作工作区）、全部 Operator 能力、面板 loopback 接口 | —（面板仍要 loopback + CSRF） |
| **Operator** | 日常使用（手机、被邀请的 PC） | 任务列表/详情/历史、prompt、停止、重命名、权限预设、审批与提问、归档/取消归档、协作文件读写、SSE | 改组设置、撤销他人、改本机设置 |
| **Reader** | 旁观/演示 | 任务列表、详情、历史、`/api/info`、订阅 SSE（只收不发） | prompt、停止、改名、审批/回答、归档、建会话、协作写、`/api/logs` |
| **Restricted** | 外部合作者，只看某个项目 | Reader 的全部能力，且**只在 `scope.workspaceIds` 与 `scope.cwdPrefixes` 范围内** | 范围外的任何读取（列表、详情、历史、协作文件一律 403 或过滤为空） |

角色绑在**凭据**上，不绑在人：同一个人可以有一把 Operator 的手机 token 和一把 Reader 的组内凭据。

## 3. 凭据 → 角色映射

| 凭据 | 默认角色 | 说明 |
|---|---|---|
| 手机设备 token（配对产生） | Operator | 面板可在设备列表里把它降成 Reader（`state.devices[].role`） |
| 组内成员凭据 `dshp_`（新增） | 邀请时指定 | 一成员一凭据，带 `role` 与 `scope`；`dshg_` 组密钥保留但只等于 Owner，且不再下发给新成员 |
| 面板 loopback | Owner | 不受角色表约束，仍要 CSRF |

`scope` 形状：

```json
{ "workspaceIds": ["ws_ab12"], "cwdPrefixes": ["F:\\work\\client-a"] }
```

空 scope = 不限（Owner/Operator/Reader 的默认）。

## 4. 守卫表（route → 最低角色）

| 路由 | 最低角色 | 备注 |
|---|---|---|
| `GET /health`、`GET /api/discovery`、`POST /api/pair`、`POST /api/group/join` | 公开 | 已有速率/一次性约束 |
| `* /api/setup/*` | Owner（loopback + CSRF） | 已经是这样 |
| `POST /api/group/{invite,link}`、`POST /api/setup/group` | Owner | 组设置 |
| `POST /api/group/hello` | 组内凭据（`dshp_`/`dshg_`） | 只回状态与 peer 列表，不回内容 |
| `GET /api/info`、`GET /api/workspaces`、`GET /api/sessions*`、`GET /api/pending`、`GET /api/events` | Reader | 结果按 scope 过滤 |
| `GET /api/group`、`GET /api/permission-presets` | Reader | |
| `GET /api/logs`、`GET /api/setup/logs` | Operator / Owner | 日志里有路径与标题 |
| `POST /api/sessions`、`POST /api/sessions/:id/{prompt,cancel,rename,permission,plan,archive,unarchive}`、`POST /api/{subscribe,unsubscribe}`、`POST /api/approvals/:id`、`POST /api/questions/:id`、`POST /api/workspaces` | Operator | 写操作 |
| `DELETE /api/sessions/:id` | Operator（建议收紧到 Owner，见 §6 未决） | 不可恢复 |
| `GET /api/collab/file(s)` | Reader（限定协作工作区内） | 仍受 `scope.cwdPrefixes` 约束 |

拒绝一律 `403 {"error":{"code":"auth/forbidden-role","message":"当前凭据角色不允许该操作"}}`。

## 5. 落地顺序（最小实现）

1. **状态**：`state.devices[].role`（默认 `operator`）；`state.group.members: [{id, name, credentialHash, role, scope, addedAt}]`。
2. **身份**：`requireIdentity()` 现在返回 `{ kind, device }`，扩成 `{ kind, role, scope, label }`；`requireAuth` 保持兼容（老 token 视为 Operator）。
3. **守卫**：在 `server.js` 里加一张 `ROLE_MIN` 表 + `requireRole(identity, 'operator')`，逐条路由套上；先用测试把「Reader 调 prompt 403」「Restricted 越界 403」钉住。
4. **过滤**：`listSummaries()`、`/api/workspaces`、`/api/events` 的 `session.snapshot` 按 scope 过滤；`/api/collab/*` 在 scope 外直接 403。
5. **凭据**：邀请时生成 `dshp_` 并写明角色；`dshg_` 只给 Owner，新成员不再拿它。
6. **面板**：设备行加角色下拉；组内成员列表显示角色；改动走 `/api/setup/*`（Owner）。

## 6. 未决与风险

- `DELETE /api/sessions/:id` 是否只给 Owner：不可恢复，倾向收紧。
- Reader 订阅 SSE 时要不要过滤 `assistant.delta`（流式正文）——如果 Reader 能看历史，正文其实已经可见，过滤意义不大，本期不单独做。
- scope 用 `cwdPrefixes` 判大小写/斜杠：Windows 上必须 `resolve()` 后再比较前缀，并禁止 `..`。
- 组密钥目前没有「轮换」：成员离开后只能重建组（重建会丢 peer 登记）。轮换排在 R26 之后。
- 角色不改变「同一台机器上的进程互信」这一事实：本机任何用户进程都能读 `state.json`（Windows 靠用户目录 ACL），这也是 R14（token 加密）只解决「手机被拿走」而不是「PC 被拿下」的原因。

## 7. 与发布门禁的关系

- G06「凭据保护」：手机 token 加密（R14）完成前不算通过。
- G07「鉴权审计」：路由守卫表落地 + 每个角色至少一条测试后，才算有覆盖。
- 本期 README 的「安全模型」按现状描述（组密钥＝全权），角色表落地后再改 README 与 `contrib` 描述。
