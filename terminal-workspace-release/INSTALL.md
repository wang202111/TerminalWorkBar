# 安装说明

官方仓库：<https://github.com/wang202111/TerminalWorkBar>。普通使用从 Releases 的 Latest 下载 `Terminal-Workspace-<版本>-macOS-source.zip`；不要误下载离线 Guide 包来安装。开发预发布带后缀，与稳定版共用安装数据，体验前请备份。

从 Git 仓库安装时在仓库根目录运行 `bash Install.command`；从应用 ZIP 安装时在解压目录运行同名入口。两种方式都不依赖作者机器路径。开发、Tag 和 GitHub Release 流程见 `RELEASING.md`。

## 1.1.0：编辑工作记录

展开任务的“工作记录”，点击对应记录右侧“编辑”，修改正文后点“保存修改”。取消不保存；保存后按更新时间置顶，旧记录按创建时间倒序。新版本不改已有任务或命令数据。

如果提示其他窗口已修改，草稿不会丢失；先复制草稿，取消弹窗、刷新后重新编辑。不要反复提交旧版本强行覆盖。Markdown 精确往返请用当前版本的“可回导 Markdown”，它会保留记录更新时间。

## 最简单的方式

1. 解压发布包到一个普通本地目录。
2. 双击 **`Install.command`**，等待完成。已有 Terminal Jump 默认保留，已有任务和命令不覆盖。
3. 打开 **iTerm2 设置**，搜索 **Python API** 并启用。
4. 双击 **`~/Applications/Terminal Sidebar.app`**，按 iTerm2 的首次连接提示授权。任务面板位于右侧。

安装需要联网获取固定版本的 Python SDK。不要使用 `sudo` 安装，也不需要把包移动到系统目录。

## 首次安装缺少环境怎么办

需要 **macOS 14+、Python 3.11+、iTerm2、Apple Command Line Tools**。

| 提示 | 处理 |
| --- | --- |
| 找不到 iTerm2 | 安装 iTerm2，将 App 放在 `/Applications/iTerm.app` |
| Python 版本太旧 | 安装 Python 3.11 或更新版本；已有 Homebrew 可执行 `brew install python` |
| 找不到 Swift 编译器 | 执行 `xcode-select --install`，等系统安装完成后再双击安装 |
| Python API 连接失败 | 在 iTerm2 设置中搜索并启用 Python API，再运行 App；不要把脚本接入误当成 SSH 密钥授权 |
| macOS 阻止打开脚本 | 确认来源可信后使用系统提供的“打开”批准流程；也可在终端进入解压目录后运行 `bash Install.command` |

如果没有 Homebrew，可以使用 Python 官方安装器。安装脚本不会自动安装 Homebrew、Command Line Tools 或绕过系统安全检查。

依赖版本：`iterm2==2.24`、`websockets==17.1`、`protobuf==7.36.2`。其中 websockets 要求 Python 3.11+。依赖装在应用专用 venv，不写系统 Python。

## 只检查，不安装

```bash
python3 install.py --check
```

如果 `python3` 指向旧解释器，可使用新 Python 的完整路径运行安装脚本。

## 用自己的 TODO / Obsidian 文件

全新安装默认使用 `~/Documents/Terminal Workspace/TODO.md`；如不存在只创建空标题文件，不自动生成任务。

指定其他文件：

```bash
python3 install.py --todo "$HOME/Documents/My Notes/TODO.md"
```

已有文件内容不会覆盖。该参数设置“读取当前 TODO”的来源以及默认导出目录，不是实时双向同步。需要在面板里点“导入 Markdown” → “读取当前 TODO.md” → 预览 → 确认。

已有安装不传 `--todo` 时，会保留原 `settings.json` 中的路径，不把它切换到发布包或示例文件。

## 添加第一个终端

1. 点“添加任务”，填写名称。
2. 点“新建终端并关联”。
3. 选择本机 SSH 别名，或手动填 `user@host`；填写真实 tmux session。
4. 保存入口，再保存任务。到这一步没有执行任何命令。
5. 点任务上的终端按钮才建立连接。

不确定远端 session 名称时点“查询远端”。需要密码或主机信任确认的 SSH 连接，应先在普通终端完成配置；后台查询不提示密码。

只想试用界面而不连接服务器，可以按 `examples/README.md` 创建本地示例入口，再手动导入虚构任务。

## 升级

解压新版，再双击 `Install.command`。安装器停止并更新侧栏本机服务，但不关闭 SSH / tmux 终端。

- 默认保留 Terminal Jump App 和所有命令。
- 侧栏任务、备份、运行令牌和已有 TODO 内容不替换。
- 默认保留原 TODO 路径。
- 若需要显式升级 Terminal Jump 原生 App：`python3 install.py --upgrade-launcher`。仍保留命令配置。
- 如暂不需要启动服务：`python3 install.py --no-start`。

如果以前安装的专用 venv 使用旧 Python，请先停止服务，将旧 venv **重命名保留**，再用 Python 3.11+ 安装；不要删除任务或命令配置目录。

## 安装位置与权限

```text
~/Applications/Terminal Jump.app
~/Applications/Terminal Sidebar.app
~/.local/bin/terminal-jump
~/.local/bin/terminal-sidebar
~/Library/Application Support/Terminal Jump/
~/Library/Application Support/Terminal Sidebar/
~/Library/Application Support/iTerm2/Scripts/Terminal Sidebar.scpt
```

所有配置和运行状态路径见 `HANDOFF.md`。如需 Apple Events / 自动化许可，请只批准本工具对 iTerm2 的必要访问；安装器不会自行打开 Python API。

## 停止或卸载

先执行 `~/.local/bin/terminal-sidebar stop`。再移除对应 App、CLI、应用支持目录及 iTerm2 菜单脚本。在 Toolbelt 中取消显示 Terminal Sidebar。

数据目录可以先保留。不要为卸载侧栏删除 SSH config、远端 tmux 或第一版命令配置；也不要执行任何远端 `kill-server`。删除第一版 App 后旧 `terminal-jump://` 链接无法继续打开，重新安装可恢复协议处理。
