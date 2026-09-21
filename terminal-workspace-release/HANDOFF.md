# Terminal Workspace — 完整交接

准确发行版本以 `VERSION` 为准。本文只描述软件行为和通用示例，不记录开发者或使用者的真实机器、任务、连接内容和运行状态。

仓库名称为 **TerminalWorkBar**，历史安装包继续命名 **Terminal Workspace**；Terminal Jump / Sidebar 的 App 名、bundle ID、URL 协议和数据目录不改名，以便升级兼容。开发入口为仓库根目录 `README.md`，分支、Tag、CI、预发布、稳定发布、安装包与说明网站的版本关系详见 `RELEASING.md`。完整仓库和解压后的应用包都可使用各自的 `Install.command` 安装；示例与个人数据必须分离。

## 1. 目标与不做的事情

目标：以多级任务树组织工作，让每一级任务关联一个可复用终端，并能记笔记、在 Markdown 与 UI 间手动往返编辑。

不是远程终端代理、SSH 密钥管理器、终端录屏、云同步系统或完整项目管理平台。不自动读取 shell 历史、终端内容、聊天记录，不自动执行任务描述。

本实现将网页注册为 iTerm2 原生 **右侧 Toolbelt** 工具；不实现左侧伴随窗口，也不把任务树伪装成 Tab Bar。只在显式打开 App / CLI 时显示侧栏，没有登录自启或定时任务。注册不会主动启用 Profiles 工具。

## 2. 名称与层级定义

| 概念 | 准确定义 |
| --- | --- |
| Terminal Workspace | 本源码发行包的总名称，不是第三个后台服务 |
| Terminal Jump / V1 | 原生 SwiftUI 配置 App + `terminal-jump://` URL 处理器 + 命令启动 / 定位器 |
| Terminal Sidebar / V2 | Python HTTP 服务、网页任务面板、iTerm2 Python API 注册脚本 |
| 节点 node | 任务树的最小实体，有稳定 ID，可拥有父级、子级、终端关联、记录 |
| 目录 group | `kind=group` 的节点；不计入待办任务数量，不显示完成复选框 |
| 任务 task | `kind=task` 的节点；可独立完成，也可以有任意深度子级 |
| 记录 note | 节点下可追加和编辑的纯文本，含稳定 ID、created、可选 updated；不是终端捕获日志 |
| 命令入口 command | ID → 本机 argv / 标题 / 可选工作目录的配置，不等于已经运行的终端 |
| iTerm2 session | 本机 iTerm2 的 pane，具有 iTerm2 session ID；用于定位和复用 |
| tmux session | 远端或本机 tmux 服务器里的会话；与命令 ID 和 iTerm2 ID 无关 |
| tmux window / pane | tmux session 内的窗口 / 分屏，不是 iTerm2 标签页 |
| SSH 主机 | OpenSSH 别名或 `user@host`；不是 tmux session 名称 |
| 关联 | 节点的 `command_id` 引用命令入口；父子之间不继承、不覆盖关联 |

任意目录 / 任务都可关联自己的终端、记录和子任务。父任务完成不会完成子任务；移动节点会移动整棵子树，ID 不变。不限制业务层数；网页深层缩进封顶并显示路径，避免窄侧栏被挤空。

多个节点可关联同一命令 ID。一个命令 ID 只有一个受管理的运行实例；不同 ID 即使指向同一 tmux session，也会有不同本机连接。

## 3. 数据与执行边界

### 保存不是执行

新增 / 编辑节点、保存命令、导入 Markdown、选择 SSH 别名都不启动终端。
“打开终端”才执行本机 argv；“查询远端”会发起只读 SSH；“现在创建远端 session”需要额外确认，并会启动远端 tmux。

向导的“打开时若不存在则创建”只是把条件创建语句写进配置，保存时不运行。

### 终端生命周期

`terminal-jump://open/ID` 只接受固定协议 / host / 路径和合法 ID，不接受 URL 内的任意 shell 命令。

1. 查找配置并取得该 ID 的启动锁。
2. 如果运行锁仍被持有，使用已记录的 iTerm2 session ID 定位现有 pane，不发送文字、不重跑命令。
3. 如果没有运行实例，使用 iTerm2 默认 profile 创建标签页，执行本机 Python launcher 的 `run` 子命令。
4. `run` 持有运行锁，执行配置 argv 并记录状态；退出后释放锁，下次点击可重新启动。
5. 运行中却找不到 pane 时拒绝重复执行，不自动接管手工创建的 SSH 标签页。

修改配置不改变已经运行的命令。用户应 detach / 结束旧连接后再次点击，不要向工作中的 shell 注入新的启动脚本。

### SSH / tmux 命令约定

SSH 模式保存为 `[/usr/bin/ssh, -t, 主机, 远端脚本]`，本地脚本模式为 `[/bin/zsh, -lc, 脚本]`。本地 `cwd` 不等于远端目录。

普通 tmux 连接默认生成 `tmux -u a -t workspace`。`-u` 明确启用 UTF-8 客户端。指定 window 或自动创建时生成额外脚本；精确目标 `'=workspace'`、`'=workspace:=build'` 必须引用，防止远端 zsh 的 `=name` 展开。

查询使用 `BatchMode=yes`、8 秒连接超时、18 秒进程超时，不弹密码 / 主机确认对话框。session 查询以 `|` 分隔，并从右侧解析两个数字字段，避免某些 tmux 版本把格式里的 Tab 转为下划线。

默认只查询默认 socket 的 tmux 服务。不支持向导配置自定义 `-L` / `-S`、ProxyCommand 或任意 SSH 参数；高级需求应写完整脚本。session / window 向导名限定字母、数字、下划线和短横线，首字符不能为短横线。

不 kill、重命名 session，不使用 `attach -d` 踢掉其他客户端。指定 window 只在新连接执行时选择，再次点击现有连接只定位本机 pane。

## 4. 环境问题的已知原因

`ssh host` 通常启动交互式登录 shell；`ssh -t host 'command'` 是直接命令执行，分配 tty 并不等于要求远端 shell 加载 `.zshrc`。

zsh 的基础环境可按需要配置在 `.zshenv`；交互提示符、插件和补全放 `.zshrc`。不要在自动化脚本中单独写一行 `zsh` 再写 tmux，否则会等待交互 shell 退出。

`export HOME=...` 不会自动 `cd`。使用者需要自行确认账户真实初始 HOME 和 `ZDOTDIR`，不要将某台机器的个人路径硬编码进产品。共享 root 的启动配置会影响其他使用者，安装器不修改远端文件。

排查中文显示时应比较 tmux 的 `client_utf8`，不能只看 pane 内的 LANG。更新 UTF-8 连接命令后，已有客户端需要 detach 后重新连接，不需要停止 tmux 会话中的任务。

## 5. 本机 SSH config 选择

`ssh_config.py` 仅静态读取本机 `~/.ssh/config` 和支持范围内的 Include：

- 支持一个 Host 行的多个具体别名、引号、注释、可选等号写法、大小写关键字。
- 支持静态 Include 的多个文件、glob、绝对路径、`~/`、`%d`；用户配置中的相对 Include 以 `~/.ssh` 为基准。
- 按大小写无关的名字去重并排序，只显示可作为现有主机输入字段的具体别名；排除 `*`、`?`、字符组、否定模式。
- 不读取 known_hosts、不扫描网络、不返回私钥路径 / HostName / 用户名等配置字段内容。
- 不执行 `ssh -G`、Match exec、ProxyCommand 或任何配置中的程序。
- 不展开 Match 条件下的 Include，也不解释其他动态变量；列表只是候选集合，不是 OpenSSH 完整求值结果。真正连接仍由系统 OpenSSH 解析配置。
- 限制递归深度 12、文件数 128、单文件 256 KiB、总读取预算 1 MiB；循环去重，异常 / 不支持部分返回提示。额外文件只可能读取到用于确认越界的一小段，随后停止处理。

界面在新增 / 编辑 SSH 或 tmux 入口时读取候选列表。选择别名会填入主机字段并清空旧 tmux 查询结果；重新读取不会覆盖手动输入或原入口的主机。不自动选第一台服务器。没有配置、解析受限或列表为空时仍能手动输入。

## 6. 文件布局与权威数据

| 路径 | 用途 |
| --- | --- |
| `~/.config/terminal-jump/commands.json` | 两个 App 共用的命令配置 |
| `~/.config/terminal-jump/commands.json.bak` | 最近一次命令修改前备份 |
| `~/.config/terminal-sidebar/tasks.json` | 侧栏任务 / 记录的权威数据 |
| `~/.config/terminal-sidebar/tasks.json.bak` | 最近一次任务修改前备份 |
| `~/.config/terminal-sidebar/tasks.pre-delete-*.json` | 每次有效删除前独立完整备份 |
| `~/.config/terminal-sidebar/tasks.pre-tree-*.json` | 从旧分组模型迁移时的独立备份 |
| `~/.config/terminal-sidebar/token` | 本机网页 API 私有访问令牌，不得分享 |
| `~/Library/Caches/terminal-sidebar/runtime.json` | 当前 PID、端口、origin、带令牌 URL |
| `~/Library/Caches/terminal-sidebar/server.log` | 本机服务日志，不应发布 |
| `~/Library/Caches/terminal-jump/ID.json` | 命令实例状态 / iTerm session ID |
| 同目录 `*.launch.lock` / `*.running.lock` | 文件锁用于启动串行化 / 运行实例判断 |
| `~/Library/Application Support/Terminal Sidebar/settings.json` | TODO 来源路径；升级默认保留 |

App、CLI、源码运行副本及 venv 的安装路径见 `INSTALL.md`。

原始 TODO 与导出 Markdown 不是任务数据库，不会因勾选、编辑、删除自动被重写。默认导出写到 TODO 所在目录下的 `terminal-sidebar/exports/`，也可以通过系统保存对话框选择新文件位置。

## 7. Schema 与版本

### 任务 schema 2

```json
{
  "version": 2,
  "revision": 0,
  "imports": [],
  "tasks": [{
    "id": "example-task",
    "title": "示例任务",
    "parent_id": "",
    "kind": "task",
    "command_id": "demo-shell",
    "done": false,
    "notes": [{"id": "example-note", "text": "纯文本记录", "created": "2026-01-01T09:00:00+00:00"}],
    "created": "2026-01-01T09:00:00+00:00",
    "updated": "2026-01-01T09:00:00+00:00"
  }]
}
```

`parent_id=""` 表示顶层。ID 唯一，父级必须存在且不可形成循环。`imports` 保留旧固定 TODO 导入的路径去重信息，不用于新 Markdown 稳定 ID 匹配。

任务 mutation 必须携带当前整数 revision；文件锁内再次检查，合法操作只递增一次，然后备份并原子替换。不要绕过 `Store.mutate` 直接写活动文件。

命令配置是 ID → `{title, argv, cwd?}` 的对象，参考 `examples/commands.example.json`。命令 ID 为 1–64 字符，首字符为字母 / 数字，后续可含下划线 / 短横线。命令 revision 是文件内容 SHA-256，与任务 revision 不同。

`config_manager` 保留未改动的 argv 及已有扩展字段；编辑 ID 固定，防止外部链接失效。新增时已有 ID 拒绝覆盖。单次批量新增是整批验证后写入。

发行版版本 `1.1.0`、任务 schema `2`、Markdown 格式头 `format:1`、Toolbelt 标识 `local.terminal-sidebar.v2` 是不同维度。不能为“升版本”随意改动 schema 或 Toolbelt 标识。原生 App 内部版本也不要求与套件版本相同。

### 工作记录编辑与排序（1.1.0）

每条记录右侧提供“编辑”。弹窗保存后保留 ID 与 created，仅修改正文和 updated；更新时间由后端写入，不能由请求指定。旧记录无需迁移，缺少 updated 时按 created 排序。UI、导出预览、两种 Markdown 均按该时间倒序；相同时间保持原相对顺序。读取和升级不重写现有 notes 数组。

编辑用打开弹窗时的任务 revision，通过原有锁、修改前 `.bak` 和原子写入提交。空白 / 超长 / NUL 正文、错误 task ID / note ID 或过期 revision 被拒绝，UI 保留草稿供复制，不自动覆盖。取消不写库。没有增加单条记录删除功能。

Roundtrip 的 ts-note 允许可选 updated 字段；旧文档仍可导入。按记录 ID 匹配后，在 Markdown 中改正文会产生新的更新时间；未改正文则保留导出更新时间。阅读版不携带时间元数据，不作为精确恢复格式。1.0.0 不承诺保留新增 updated 元数据，应在 1.1.0 进行往返操作。

## 8. 两种删除的区别

**删除节点**：
- 默认只删除当前节点及其记录；直接子级移到原节点父级，其后代 ID、内容、关联和内部结构不变。
- 用户可明确选择删除本级和所有后代；确认窗口显示节点及记录数。
- 确认携带打开窗口时的 revision，期间其他修改会使删除失败，避免漏看新加子级。
- 删除前写入独立 `tasks.pre-delete-*` 完整备份；不改终端配置、SSH、tmux、原始 TODO 或已导出文件。

**删除终端入口**：
- 必须明确确认；界面列出当前关联节点。
- 从共用命令配置删除，因此两个 App 都不再提供该入口。
- 不关闭运行实例、不删除任务 / 记录。已有节点的 command_id 保留为失效关联，可重新选择或重建同 ID。

没有界面内回收站 / 撤销，也没有单条记录独立删除按钮。用备份恢复时应先备份当前数据，避免旧快照覆盖更新后的其他内容。

## 9. Markdown 合约

### Pretty

标准嵌套列表、加粗目录、任务复选框、终端链接和引用记录，无内部 ID 注释。适合阅读和分享。重导按名称路径匹配；重命名 / 移动可能新增节点，不保证恢复全部内部元数据。

### Roundtrip

文档头 `<!-- terminal-sidebar: {"format":1} -->`，节点尾部 `ts-node` 保存 ID / kind，记录用 `ts-note` 保存 ID / created 及可选 updated，正文为 `>` 引用。HTML 注释在阅读模式隐藏，源码中保留。

导入会：
- 先解析并预览新增 / 更新 / 未变数量和变更字段，再显式应用。
- 用稳定 ID 匹配有 ID 的节点；无 ID 按完整名称路径匹配，歧义或重复指向拒绝。
- 覆盖已出现节点的名称、上级、类型、完成状态和关联；省略链接会解除关联。
- 保留文件没有出现的节点，不做“缺失即删除”同步。
- 带 ID 或格式头时按文件替换记录，删除记录内容意味着清空；普通无 ID 文档没有记录时保留旧记录。
- 提示并保留未知 command_id，不自动创建命令，也不执行文件中的指令。
- 忽略普通段落和围栏代码；识别标题、列表缩进和记录引用。记录放在所属节点之后、子节点之前。

原有子级在部分导入时仍保留。改动导入文本会使前端预览失效；其他窗口更新 revision 会使应用失败。旧导出文件即便有稳定 ID，明确导入后仍可能覆盖同 ID 的新内容，预览不是自动三方合并。

HTTP JSON 请求上限 256 KiB；网页文件选择限制 240 KB，转义后也要满足请求大小。每次最多 5000 个导入节点，标题 300 字符、单条记录 20000 字符。大文档应分批。导出本身可能大于可一次导入的上限。

## 10. API 与 UI 对照

全部为本机私有 API，不是承诺稳定的公共 SDK。

| API | 行为 |
| --- | --- |
| `GET /api/state` | 任务 snapshot、命令 catalog、两种 revision |
| `POST /api/task` | 新增 / 编辑 / 移动节点 |
| `/api/complete`、`/api/note` | 完成状态 / 追加纯文本记录 |
| `/api/note_edit` | POST id（任务）、note_id、note（正文）、revision；编辑已有记录，保留 ID / created |
| `/api/task_delete` | 需 `confirmed=true`、scope=node 或 subtree、任务 revision |
| `/api/command` | 新增或编辑入口；编辑需 original_id，携带 command_revision |
| `/api/command_delete` | 确认删除入口，携带 command_revision |
| `/api/open` | 按 command_id 启动 / 定位终端 |
| `/api/open_v1` | 打开原生命令管理 App |
| `/api/ssh_hosts` | 只读静态枚举本机 SSH 候选别名 |
| `/api/tmux_list` | 只读 SSH 查询 session / window 数 / attached 数 |
| `/api/tmux_create` | 需明确确认，创建远端后台 session |
| `/api/markdown_source` | 读取 settings 中固定 TODO 来源，不接受任意客户端文件路径 |
| `/api/markdown_preview`、`/api/markdown_import` | 文本预览 / 带 revision 应用 |
| `/api/export_preview`、`/api/export` | format=pretty 或 roundtrip；保存可选默认目录或系统对话框 |
| `/api/import` | 旧固定 TODO 增量导入接口，保留兼容；新 UI 使用 Markdown 预览流程 |

UI 关联时新增终端会保留节点草稿，保存入口后自动选中，仍需保存节点才建立关联。取消节点编辑不会自动删除刚保存的入口。

导出预览不会写文件。保存使用独占创建，不覆盖已有文件；系统对话框取消不写文件。预览后任务版本改变会拒绝保存并要求重新生成预览。

## 11. CLI

```bash
terminal-sidebar start
terminal-sidebar status
terminal-sidebar open
terminal-sidebar browser
terminal-sidebar stop
terminal-sidebar export output.md
terminal-sidebar export roundtrip.md --format roundtrip
terminal-sidebar import input.md
terminal-sidebar import input.md --apply
terminal-jump list
terminal-jump open demo-shell
```

实际可执行文件在 `~/.local/bin/`，未加入 PATH 时使用完整路径。
`import` 默认只预览；`--apply` 明确写入，执行时会重新计算变更。CLI 与 UI 共用锁和 revision，但 CLI 修改后网页需要刷新。

## 12. 安全边界

HTTP 只绑定 127.0.0.1，使用私有令牌，并校验 Host / Origin；无开放 CORS。静态网页 URL 带令牌，API 用 `X-Sidebar-Token`。不要分享 runtime.json、带令牌 URL 或服务日志。

网页无第三方脚本、字体和遥测。内容通过 textContent 渲染，不把任务 / 记录直接作为 HTML 执行。配置的 shell 命令本身仍是可信代码，保存陌生命令前必须自行检查。

用户配置和 SSH 凭据属于本机账户，不以本产品转发至云。读取 SSH 候选别名不代表这些目标安全可信。后台 SSH 查询仍遵循 OpenSSH 的本机配置，不绕过 host key 验证。

发布包不是云端同步或完整账号备份。打包时必须使用白名单；禁止直接压缩工作 vault、用户安装目录、缓存或真实导出目录。

## 13. 源码维护地图

| 文件 | 职责 / 修改注意 |
| --- | --- |
| `terminal-jump/TerminalJump.swift` | 原生命令编辑界面；不要放个人主机默认值 |
| `terminal-jump/config_manager.py` | catalog、argv 转换、配置 revision / 锁 / 原子写入 |
| `terminal-jump/terminal_jump.py` | URL 验证、iTerm AppleScript、运行锁、状态注册 |
| `terminal-sidebar/sidebar.py` | Store、服务路由、tmux 向导、导出保存、服务生命周期 |
| `terminal-sidebar/markdown_io.py` | 导出、解析、合并；稳定 ID 与保留策略是兼容性重点 |
| `terminal-sidebar/ssh_config.py` | 只读候选枚举，不是 OpenSSH 解释器 |
| `terminal-sidebar/register_tool.py` | Python API 注册 / 显式展示；UI 更新用 query 版本刷新 webview |
| `terminal-sidebar/static/` | 无框架网页、对话框、树、草稿、预览；不使用内联 JS |
| 两个组件 `install.py` | 本机安装；新运行模块必须加入复制清单 |
| 根 `install.py` | 安装前检查、组件协调、默认保留原 V1 |
| `build_release.py` | 明确复制白名单、合成示例 Markdown、生成 manifest 和 ZIP |

新增字段时先定义兼容策略；不要仅在 UI 中防循环 / 防重名 / 防过期，后端仍需验证。新增命令执行行为必须有清晰用户触发点，不藏在 snapshot、导入、选择或保存里。

## 14. 安装与恢复约定

安装器不改 SSH config，不启用 Python API / 系统授权，不自动导入任何示例。新命令配置为 `{}`，新任务由 Store 初始化为空。已有 TODO 路径默认保留，只有显式 `--todo` 才切换；不会覆盖已有文件内容。

Python 3.11+ 是当前固定依赖的下限，不要沿用旧文档的更低版本要求。旧 venv 不会因为选择了新 Python 自动重建；参见 INSTALL 的安全重建方式。

维护更新前先备份数据，再停止侧栏服务、更新运行副本、启动并重新打开 App。不能用“源码已改”代替确认已安装运行副本一致。停止侧栏不停止 Terminal Jump 运行实例。

恢复删除内容时，优先从删除前备份提取所需节点；如要整库回滚，先停止服务并备份当前库，确认会丢失哪些后续变更。不要直接把示例 JSON、旧导出或旧备份覆盖活动数据。

## 15. 已知限制与后续交接

- 未做完整跨版本 / 跨架构兼容矩阵；当前验证环境见 TESTING。
- 没有拖拽排序、自动 Markdown 文件监听、实时多窗口推送、记录单独删除、回收站或云同步。
- 任务树没有自定义兄弟排序字段，Markdown 导入也不承诺重新排序所有已有兄弟节点。
- SSH 候选列表是静态子集，动态 Match / Include 可能缺失，请保留手动输入。
- 原生保存对话框在后台可能需要用户切到前台；若不可用可保存到默认目录。
- API 读取状态不会刷新已连接 tmux 的环境；字符集和启动命令改变需要重新 attach。
- 修改 / 删除共用命令会同时影响两个 App，不能假设 V1 / V2 各有独立命令数据库。

交给下一位维护者时：先读本文件和 INSTALL，再看示例与源码。只使用临时任务 / 配置做破坏性测试；确认用户授权前不要清理真实任务、终端、SSH 文件或远端会话。发行时从白名单重新构建，不把用户环境当成“默认样例”。
