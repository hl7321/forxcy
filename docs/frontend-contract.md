# 前端接口契约（locapp / forxcy）

> 这份文档的作用：**任何前端都可以替换，只要遵守这里的接口约定，位置、访问码、视频这些功能就不会坏。**
> 前端可以是现在的纯静态页面，也可以是将来用别的模板、甚至 React 重做的版本。
>
> 适用版本：`1da12f1`（2026-10）｜后端文件：`app.py`｜前端文件：`static/`

## 0. 整体结构（谁负责什么）

```
手机 OwnTracks ──HTTPS /pub（Basic Auth）──► nginx ──► Recorder 容器（127.0.0.1:8083）
                                                        └─ 位置数据：/opt/owntracks/store

浏览器 ──HTTPS 8443──► nginx ──► app.py（127.0.0.1:8000）
                                  ├─ 页面：static/ 下的 HTML/CSS/JS
                                  ├─ 接口：/api/*
                                  └─ 视频：/media/*
```

- 后端只有 **Python 标准库**：没有数据库、没有构建流程、没有第三方依赖。
- nginx 负责 HTTPS 证书与 `/pub` 的口令；其余全部由 `app.py` 处理。
- **换前端＝替换 `static/` 里的文件**，不需要动服务器配置。

## 1. 接口清单（必须原样遵守）

| 接口 | 登录 | 请求 | 成功响应 | 失败响应 |
|---|---|---|---|---|
| `POST /api/login` | 否 | `{"code":"六位访问码"}` | `200 {"ok":true}` + `Set-Cookie: loc_auth=…` | `403 {"ok":false,"error":"访问码错误"}`；`429` 触发限流，带 `retry` 秒数 |
| `GET /api/state` | 是 | — | `200 {"ok":true,"role":"friend","stopped":false,"has_location":true,"lat":37.8,"lon":112.5,"tst":1791…,"batt":30}` | `401 {"ok":false,"error":"unauthorized"}` |
| `GET /api/videos` | 是 | — | `200 {"ok":true,"videos":[{"name":"clip-01.mp4","title":"clip-01","size":2320633,"mtime":1791…,"url":"/media/clip-01.mp4","type":"video/mp4"}]}` | `401` 未登录 |
| `GET /media/<文件名>` | 是 | 支持 `Range: bytes=…` | `200` 或 `206` + `Content-Range`、`Accept-Ranges: bytes` | `401/403` 未登录；`404` 不存在 |
| `POST /api/owner_login` | 否 | `{"pass":"控制台密码"}` | `200 {"ok":true}` + `Set-Cookie`（角色 `owner`） | `403` / `429` |
| `POST /api/owner_action` | 需 owner | `{"action":"stop"}` 或 `{"action":"start"}` | `200 {"ok":true,"stopped":true}` | `403` 非 owner |
| `GET /api/logout` | 否 | — | `200`，清除 Cookie | — |
| `GET /` | 否 | — | 新版入口页（`static/home.html`，2026-10-09 起为默认） | — |
| `GET /new` | 否 | — | 同上（保留的别名，避免旧链接失效） | — |
| `GET /legacy` | 否 | — | 旧版入口页（`static/index.html`），回退用 | — |
| `GET /map` | **是** | — | 地图页（`static/map.html`） | 未登录 `302 → /` |
| `GET /owner` | 否 | — | 控制台页面（页面内自行判断登录状态） | — |
| `GET /robots.txt` | 否 | — | 禁止抓取 | — |

### 字段含义（不要改名）

- `lat` / `lon`：**WGS-84** 原始坐标（前端负责转成高德坐标）
- `tst`：上报时间（Unix 秒）；`batt`：手机电量百分比
- `has_location`：是否拿到过位置；`stopped`：是否已"停止共享"
- `videos[].url`：**必须直接用作播放地址**（已经是 URL 编码后的路径）
- `videos[].title`：文件名去掉扩展名

## 2. 登录与会话（最容易做错的地方）

- **绝对不要在前端判断访问码**。必须调用 `POST /api/login`，由服务器验证并下发 Cookie。
- Cookie 名为 `loc_auth`，属性 `HttpOnly; SameSite=Lax; Path=/`，有效期 30 天；角色为 `friend` 或 `owner`。
- 前端请求同源接口时**默认会带 Cookie**；用 `fetch` 时不要设成 `credentials: "omit"`。
- 限流规则：**同一 IP 对同一 realm 连续 5 次失败 → 锁 60 秒**，返回 `429` 并给 `retry` 秒数。
- ⚠️ **已知问题（建议修复）**：线上 systemd 里没有设置 `LOCAPP_TRUSTED_PROXY_CIDRS`，导致 `app.py` 只看到 nginx 的 `127.0.0.1`，于是**所有访客共用一个限流桶**（任何人连续输错 5 次，会锁住所有人 60 秒）。修复方式：在 `/etc/systemd/system/locapp.service` 增加
  `Environment=LOCAPP_TRUSTED_PROXY_CIDRS=127.0.0.1`，然后 `daemon-reload` + 重启服务。

## 3. 视频与媒体

- 列表按**修改时间倒序**（最新在前）；**文件名就是标题**，改名即改标题。
- 支持的扩展名：`.mp4`、`.mov`、`.m4v`、`.webm`。
- 播放器必须：`controls`、`preload="metadata"`、`playsinline`；**服务端支持 Range，否则 iPhone 无法播放和拖动进度**。
- 上传方式：把文件放进服务器 `/opt/locapp/media/` 即可，刷新即出现（无需重启服务）。
- 带宽上限 **4Mbps ≈ 500KB/s**，月流量包 300GB；建议单条视频 **≤ 20–50MB**，或码率 **≤ 3Mbps**（4K 原片会严重卡顿，需要先压缩）。
- 文件名会进入 URL（已做百分号编码），建议只用中英文、数字、短横线，避免特殊符号。

## 4. 前端自己负责的事（后端不管）

- **坐标转换**：WGS-84 → GCJ-02（高德坐标），现有实现在 `static/map.js`。
- **地图瓦片**：直连高德 `webrd0{1-4}.is.autonavi.com`（免费、无 key，个人使用量足够）。
- **轮询**：地图页每 10 秒拉一次 `/api/state`；位置超过 5 分钟未更新要显示"过期/陈旧"状态。
- **文案**：全部集中在 `static/content.js`，改文字不用碰逻辑。
- **入口优先级**：`localStorage.letter_seen` 决定"读信/查看位置"谁排前面。
- **隐私底线**：不引入外部 CDN、不接统计/追踪脚本、不请求访客定位；页面保留 `noindex`。

## 5. 换前端时的检查清单

- [ ] 保留三个页面路径：`/`（入口）、`/map`（需登录）、`/owner`（控制台）
- [ ] 不改接口字段名（`lat/lon/tst/batt/stopped`、`videos[].url` 等）
- [ ] 登录一律走 `/api/login`，不在前端比对密码
- [ ] 视频播放器同源请求（自动带 Cookie）且服务端支持 Range
- [ ] 不引入外部域名资源（字体、图标、CDN 都放本地）
- [ ] 部署方式：把产出的静态文件覆盖到 `/opt/locapp/static/` 即可；即使前端用了构建工具，**服务器只需要静态产物，不需要 Node**
- [ ] 改完跑一次验收脚本 `verify.sh`（首页/控制台/登录/位置/证书/上报六项）+ 手机上实际看一眼
- [ ] 改坏了用 Git 回退（`git revert` / `git checkout`），后端不在改动范围内就不会伤到定位

## 6. 如果将来要连后端一起换

可以，但要一次性完成下面这些，否则会出现"半新半旧"的冲突：

1. 新后端实现上面**全部**接口（字段名保持一致）；
2. 更新 nginx 反代目标（`/` → 新服务端口），`/pub` 保持指向 Recorder；
3. 迁移系统服务（systemd 单元）与开机自启；
4. 迁移 Cookie 签名密钥（`/opt/locapp/secret`），否则所有人的登录状态失效；
5. 迁移 `media/` 与位置历史（如果新后端还要读历史）。

例如换成 Node/Next.js：需要额外安装 Node 运行时、进程守护，并把构建产物或服务接进 nginx——工作量比"只换前端"大一个量级。
