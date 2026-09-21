# Terminal Workspace / TerminalWorkBar

macOS + iTerm2 的本地任务与终端工作台。包含独立的 Terminal Jump 命令管理 App，以及嵌入 iTerm2 右侧 Toolbelt 的 Terminal Sidebar。

## 先看哪里

- **可视化使用手册另行提供：`Terminal-Workspace-Guide-<版本>.zip`**。解压后打开 `index.html` 体验三个原版前端 demo 窗口；每段只播放一遍并保留结果，不再强制滚动整页。产品短片、完整手册保留在单独页面，与应用安装包独立。
- **安装与升级：`INSTALL.md`**。解压后双击 `Install.command`；首次使用需要 Python、iTerm2 和 Apple Command Line Tools。
- **完整交接：`HANDOFF.md`**。概念定义、数据模型、接口、运行边界、维护及恢复方法。
- **纯虚构示例：`examples/README.md`**。示例不会自动导入，不包含任何真实账户、主机、任务或历史记录。
- **验证范围：`TESTING.md`**。已验证项、限制、建议回归检查。
- **版本变更：`CHANGELOG.md`**。
- **仓库、Tag 与发布流程：`RELEASING.md`**。本包的准确版本见 `VERSION`；项目仓库为 `wang202111/TerminalWorkBar`，App 名称、URL 协议和数据目录保持兼容。

## 能做什么

- 任意层级的任务 / 目录树，每个节点可关联自己的终端并添加记录。
- 工作记录支持编辑；最近新增 / 修改的记录显示在上面，两种 Markdown 导出顺序一致。
- 关联时直接新增 / 编辑入口；独立终端列表支持编辑和确认删除。
- 从本机 SSH config 选择候选别名，也可以手动输入主机。
- 只读查询远端 tmux；可明确选择创建 session / window，保存配置不执行命令。
- 一个命令 ID 对应一个受管理的终端；重复点击只定位，不向工作中的 shell 注入文字。
- 清爽层级 Markdown 或保留 ID 的回导格式；导入先预览，保存文件可选位置。
- 删除单节点并保留子级，或确认删除子树；删除前保留独立备份。

## 发布边界

这是 **macOS 源码安装包**，不是签名公证的预编译 App。安装时在本机编译适合本机架构的 App，并作 ad-hoc 签名；不承诺 Gatekeeper 免确认。

全新安装为空任务、空命令。升级默认保留已有数据、TODO 路径及第一版 App。安装不会开启 SSH 连接、修改 SSH config、启用系统权限或运行示例。

本包不包含个人配置、真实 TODO、导出快照、运行缓存、访问令牌、SSH 文件、密钥、日志、venv 或已安装 App。构建采用明确文件白名单，`MANIFEST.json` 列出内容与 SHA-256；压缩包旁另有整包校验文件。

源码布局：

```text
Install.command             双击安装入口
install.py                  安装协调与只读环境检查
terminal-jump/              原生 App / URL launcher / 配置管理
terminal-sidebar/           HTTP 服务 / 多级任务 / 网页 / iTerm 注册
examples/                   完全虚构的数据与操作示例
build_release.py            白名单构建器
```

安装后常用入口：

```bash
~/.local/bin/terminal-sidebar open
~/.local/bin/terminal-sidebar browser
~/.local/bin/terminal-sidebar status
~/.local/bin/terminal-sidebar stop
```

需要重新打包时，在解压目录运行 `python3 build_release.py --source-root . --assets . --output ../dist`。输出目录中同名版本已存在时会拒绝覆盖，请选择新目录或明确整理旧产物。
