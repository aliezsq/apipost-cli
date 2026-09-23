# apipost-open-cli

Apipost Open API V2（SaaS 版）的命令行客户端。用一条命令程序化管理 Apipost 项目：项目/接口 CRUD、自动化测试报告、环境与数据模型、团队成员、全局参数等，覆盖全部 **55 个接口（47 条命令）**。

> 与官方 `apipost-cli` 的区别：官方那个是跑接口用例/测试用例的 CI 运行器（`apipost run <ci_url>`），本工具是 **Open API V2 的资源管理**（建接口、管环境、管数据模型、查测试报告），两者不重叠。为避免 bin 冲突，本工具命令名是 `apipost-open`。

## 安装

```bash
# 从 npm 安装（推荐）
npm install -g apipost-open-cli

# 或直接从 GitHub 装（零发布零登录）
npm install -g github:aliezsq/apipost-cli

# 或本地源码安装
cd apipost-cli && npm link
```

要求 Node.js ≥ 18（内置 fetch）。

## 获取 token

Apipost 客户端 → 工作台 → 项目设置 → 对外能力 → open API，复制 `api-token`。

通过环境变量或参数传入（二选一）：

```bash
export APIPOST_TOKEN=你的token
apipost-open team list

# 或每次带参数
apipost-open --token 你的token team list
```

## 全局参数

| 参数 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `-t, --token` | `APIPOST_TOKEN` | — | api-token |
| `--host` | `APIPOST_HOST` | `https://open.apipost.net` | API 地址，含协议；私有化版按部署地址改 |
| `--json` | — | — | 输出紧凑单行 JSON |
| `--unwrap` | — | — | 只输出响应里的 `data` 字段 |
| `--dry-run` | — | — | 只打印将发出的请求，不实际发送 |
| `--timeout <ms>` | — | `30000` | 请求超时 |

鉴权固定走请求头 `api-token: <token>`（连字符）。

## 命令分组

```
apipost-open team list                      我的群组列表
apipost-open user info                      获取个人信息
apipost-open project create|list|info|members
apipost-open api list|detail|create|update|delete|set-mark|sample-list|sample-create
apipost-open test list|delete|report-list|report-detail
apipost-open model list|detail|create|update|delete
apipost-open attribute create|update|list|detail|delete
apipost-open mark create|update|list|delete|set-default
apipost-open env create|update|delete|list|detail|move
apipost-open server create|update|delete|list|detail|move
apipost-open global-param detail|save
```

每个子命令都有 `--help`，会列出该接口的 query 参数、是否必填、以及默认值。

## 用法示例

```bash
# 列出我的项目（action 默认 0=全部；team_id/team_code 二选一）
apipost-open project list --team-id 4381362a5401000

# 项目详情（project_id/project_code 二选一，project_id 优先）
apipost-open project info --project-id 57ddb72dc088000

# 创建项目：扁平 body 直接给标量 flag
apipost-open project create --team-id 4381362a5401000 --name 新项目 --intro 描述

# 复杂 body（接口创建/修改等）用 --data 或 @文件
apipost-open api create --data @/path/to/api.json
apipost-open api update --data '{"project_id":"...","target_id":"...","name":"改名"}'

# 预览某接口的请求，不发送
apipost-open api create --type http --dry-run
```

## 请求体约定

- `--data '<json>'` 或 `--data @file.json`：完整请求体，**优先级最高**，覆盖标量 flag。
- 扁平 body 的接口（如 `project create`、`mark create`）会自动把顶层标量字段生成 flag（`--name`、`--color` 等）。
- 复杂嵌套 body（`api create`、`api update` 等）必须用 `--data`。
- `api create` 的 `--type` 仅用于选择/预览 9 种接口类型模板，实际发送以 `--data` 为准。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功（信封 `code == 0`） |
| 1 | HTTP 非 2xx，或业务错误（信封 `code != 0`，msg 打到 stderr） |
| 2 | 本地错误（缺参数、缺 token、网络失败等） |

注意：Apipost 接口**失败时也可能返回 HTTP 200**，所以业务成败以信封 `code` 为准，不是 HTTP 状态码。

## 能力边界

V2 开放接口里自动化测试（`test`）只有 `list` / `delete` / `report-list` / `report-detail`，**没有创建或执行测试的接口**——「跑自动化测试」暂无法通过本 CLI 完成，需在客户端内触发，或用官方 `apipost-cli` 的 `apipost run`。

## 说明

- 接口定义来自 Apipost 导出的《开放接口文档 V2 版本（saas 版）》，解析后生成 `spec.json`（单一事实源）。
- 文档里的示例 ID（如 `testing_id=2069ad04ec01000`）不会被当作默认值发出；只有真正的默认值（如 `action=0`）会在未传参时自动补上。
- `team_id`/`team_code`、`project_id`/`project_code` 均为「二选一」参数，至少传一个即可。

## License

MIT
