# TerminalWorkBar

把任务、工作记录和可复用终端放在一起。面向 **macOS + iTerm2 + SSH / tmux** 的本地工作台。

[在线动画演示与手册](https://wang202111.github.io/TerminalWorkBar/) · [稳定版下载](https://github.com/wang202111/TerminalWorkBar/releases/latest) · [所有版本 / 开发预发布](https://github.com/wang202111/TerminalWorkBar/releases) · [安装与升级](terminal-workspace-release/INSTALL.md) · [完整交接](terminal-workspace-release/HANDOFF.md) · [开发与发布](terminal-workspace-release/RELEASING.md)

## 不安装，先体验

公开网站：**<https://wang202111.github.io/TerminalWorkBar/>**。首页是可暂停、可手动操作的动画演示；页头还有产品短片和完整手册。无需登录、安装应用或连接本机服务。网站部署规则与首次启用步骤见 [Pages 说明](terminal-workspace-release/RELEASING.md#9-github-pages-公开说明网站)。

网站只使用虚构示例和内存模拟 API，不连接你的终端，不读取个人任务、SSH config 或密钥。它跟随 `main` 的稳定维护线更新；某个已发布版本的固定文档仍可从 Release 下载离线 Guide ZIP。

## 先下载哪个？

| 文件 | 用途 |
| --- | --- |
| `Terminal-Workspace-<版本>-macOS-source.zip` | 应用安装包，解压后双击 `Install.command` |
| `Terminal-Workspace-Guide-<版本>.zip` | 离线说明网站，解压后打开 `index.html`，不用安装应用 |
| 同名 `.zip.sha256` | 对应 ZIP 的完整性校验 |
| GitHub 自动附带的 Source code | 仓库源码快照；普通用户优先使用上面的应用 ZIP |

普通使用选择 **Latest 稳定版**。带 `-dev.N` / `-alpha.N` / `-beta.N` / `-rc.N` 的版本为预发布，不替代 Latest。应用与说明网站各有版本号，同一次 Release 会提供对应的两个包。

> 项目仓库名是 TerminalWorkBar；为兼容已有安装，包名仍使用 Terminal Workspace，App 仍叫 Terminal Jump 和 Terminal Sidebar。没有改名迁移数据，也不需要本项目作者机器上的任何路径。

## 安装：四步

1. 准备 **macOS 14+、Python 3.11+、iTerm2、Apple Command Line Tools**。iTerm2 放在 `/Applications/iTerm.app`。
2. 下载应用 ZIP，解压到任意普通本地目录，双击 **`Install.command`**。不用 `sudo`。
3. 在 iTerm2 设置中启用 **Python API**。
4. 打开 `~/Applications/Terminal Sidebar.app`，按提示授权。面板显示在 iTerm2 **右侧 Toolbelt**。

首次安装需要联网下载固定版本的 Python SDK，在本机编译原生启动 App。这是**源码安装包**，不是已签名公证、解压即用的二进制 App。缺少环境或被系统阻止打开时，参见 [安装说明](terminal-workspace-release/INSTALL.md)，不要关闭系统安全检查。

## 第一次使用

1. 添加项目或任务，再通过“＋ 子级”建立多级目录。任何层级都能关联独立终端。
2. 在任务设置中选择已有入口，或直接“新建终端并关联”，不必来回切到终端管理页。
3. 选择本机 SSH config 中的别名，填写 tmux session，按需要细化到 window / pane。保存不执行。
4. 点任务上的终端按钮：首次打开连接；再次点击定位已有终端，不重发命令。
5. 展开工作记录，添加或编辑结论。最近新增 / 修改的记录排在最上面。
6. 一键导出清爽层级 Markdown；需要精确回导时选择带 ID 的回导格式。导入先预览，再确认。

### 一个虚构的终端入口

假设你自己的 SSH config 中有 `demo-dev`，且远端已有 `workspace`：

```bash
ssh -t demo-dev 'tmux -u a -t workspace'
```

入口保存为 `demo-workspace` 后，可在支持自定义 URL 的 Markdown / Obsidian 笔记中使用：

```markdown
[打开工作终端](terminal-jump://open/demo-workspace)
```

URL 只引用已保存的入口 ID，不接受 URL 内的任意 shell 指令。若希望不存在时创建 tmux，需要显式启用向导中的创建选项；普通 attach 不会自动创建。这里的名字全是示例，不会自动导入或执行。

## 功能与边界

- 多级任务、目录、搜索、折叠，任意节点关联终端；父子关联互不继承。
- 终端入口新增、编辑、删除；SSH 别名选择、tmux 只读查询及明确确认后的创建。
- 追加 / 编辑工作记录，按更新时间倒序；删除单节点保留子级，或确认删除整棵子树。
- 清爽 Markdown / 精确回导格式，文件位置选择、导入预览、修订冲突保护和备份。
- 配套真实网页前端沙箱 demo：自动演示一次后停止，可暂停亲手试，不连真实 SSH、不读写个人数据。
- 没有云同步、登录自启或 SSH 密钥托管。不自动运行任务文字、不录屏、不捕获终端输出。UI 保存和真正执行是两件事。

完整操作与定义见 [HANDOFF](terminal-workspace-release/HANDOFF.md)，示例见 [examples](terminal-workspace-release/examples/README.md)，验证限制见 [TESTING](terminal-workspace-release/TESTING.md)。

## 升级与数据

解压新版，再运行 `Install.command`。默认保留已有任务、入口、TODO 路径及 Terminal Jump；不会结束正在运行的 SSH / tmux。示例不会覆盖你的数据。

| 位置 | 内容 |
| --- | --- |
| `~/.config/terminal-sidebar/` | 任务、运行令牌和备份 |
| `~/.config/terminal-jump/` | 终端入口配置 |
| `~/Library/Application Support/Terminal Sidebar/` | 安装后的侧栏程序、专用 Python 环境、设置 |
| `~/Library/Application Support/Terminal Jump/` | 安装后的启动器程序 |
| `~/Documents/Terminal Workspace/TODO.md` | 全新安装的默认 Markdown 来源，可自行指定 |

这些目录由当前用户的 Home 计算，不属于仓库；不要上传配置、令牌、密钥、真实 TODO 或导出快照。开发版与稳定版使用同一套安装目录，**不是相互隔离的两个 App**；体验开发版前备份数据。数据格式变更时不得盲目降级。

## 从仓库开发

```bash
git clone git@github.com:wang202111/TerminalWorkBar.git
cd TerminalWorkBar
bash Install.command --check
python3 tools/check.py --output dist/local-check
```

最后一条命令只校验源码并构建 / 检查发行包，不安装、不连接终端、不读取个人任务。实际安装才运行 `bash Install.command`。修改源码后不会自动覆盖已安装的程序，需要显式重新安装。

```text
terminal-jump/                V1 原生配置 App、URL 协议和终端定位
terminal-sidebar/             V2 任务 API、网页前端、iTerm2 注册
terminal-workspace-release/   安装器、文档、网站、虚构示例与打包器
tools/                       版本管理和发行校验
.github/workflows/           分支校验与 Tag 发布
```

`main` 是稳定线，`dev` 是开发线。提交代码不自动发布；推送匹配 `VERSION` 的 `vX.Y.Z` Tag 发布稳定版，推送预发布 Tag 发布开发版。完整命令、回滚边界与失败重试见 [RELEASING.md](terminal-workspace-release/RELEASING.md)。
