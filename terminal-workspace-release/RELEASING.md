# TerminalWorkBar 开发、版本与发布交接

仓库：<https://github.com/wang202111/TerminalWorkBar>

SSH remote：`git@github.com:wang202111/TerminalWorkBar.git`

本文中的命令除特别说明外，都在**克隆后的仓库根目录**执行。不依赖维护者机器的路径。应用包仍使用 `Terminal-Workspace-*` 命名，协议和安装路径不变；仓库名不是新的 App 或新数据格式。

## 1. 各种“版本”的定义

| 名称 | 含义 |
| --- | --- |
| `main` 分支 | 稳定维护线；提交到这里会校验，但不会自动发布 |
| `dev` 分支 | 下一版本开发线；提交只校验，不自动发布 |
| `v1.1.1` 这样的 Tag | 固定一个提交的稳定发布版本；不移动、不复用 |
| `v1.2.0-dev.1` 这样的 Tag | 开发预发布；还可用 `alpha.N`、`beta.N`、`rc.N` |
| GitHub Release | Tag 的说明与可下载 ZIP / SHA-256 附件，不等于只有源码 Tag |
| GitHub Latest | 默认推荐的稳定发布；预发布不设为 Latest |
| Actions artifact | 分支 / PR 校验时暂存 7 天的产物，不是正式 Release |
| `VERSION` | 整套应用发行版本，位于 `terminal-workspace-release/` |
| `GUIDE_VERSION` | 离线网站版本，同目录管理；网站含应用前端，随发布更新 |
| V1 / V2 | Terminal Jump / Terminal Sidebar 的历史组件称呼，不是 Git 分支或版本号 |
| 数据 schema / revision | 数据格式版本 / 并发修订号，不跟随 Git Tag 自动改变 |

发布格式限定为 `X.Y.Z`，或 `X.Y.Z-dev.N` / `alpha.N` / `beta.N` / `rc.N`，N 从 1 开始。Tag 必须是 `v` 加 `VERSION` 的精确内容。应用和网站必须同为稳定版或同为预发布。

首次接入：稳定版为 **1.1.1 / 网站 1.3.2**；开发线初始化为 **1.2.0-dev.1 / 网站 1.4.0-dev.1**。开发线初始版本用于验证预发布通道，不宣称包含额外的新产品功能。

## 2. 本地开发和安装

```bash
git clone git@github.com:wang202111/TerminalWorkBar.git
cd TerminalWorkBar
git switch dev
python3 tools/check.py --output dist/dev-check-1
```

校验需要 Python 3.11+、Git、Node.js（只用于 JS 语法检查）。不用安装第三方 Python 包。应用安装本身不需要 Node.js。

运行校验会：

1. 比较 Git 跟踪文件与发布源码白名单，拒绝额外或缺少的文件。
2. 检查源码中的用户绝对路径、常见凭据标记、Python / JavaScript 语法。
3. 核对应用、网站、App bundle、侧栏缓存标记的版本。
4. 用两个白名单构建器生成应用 ZIP、网站 ZIP、SHA-256 和 Release 说明。
5. 核对 ZIP 内容、清单、大小、摘要、安装脚本权限和网站原版前端的一致性。

校验不安装、不执行 App、不启动服务、不读个人任务、不连接 SSH。输出目录必须为空或不存在，防止把旧文件混入新发布。要重新验证时换一个目录，例如 `dist/dev-check-2`。

需要实际安装时：

```bash
bash Install.command --check
bash Install.command
```

仓库修改不热更新已安装程序。安装器同时支持仓库结构和发布包结构；详细环境、授权、升级步骤见 `INSTALL.md`。

## 3. 发布开发版

开发与功能验证在 `dev` 完成。每次发布使用新的版本与 Tag：

```bash
git switch dev
git pull --ff-only origin dev
python3 tools/set_version.py 1.2.0-dev.2 --guide 1.4.0-dev.2
```

然后编辑 `terminal-workspace-release/CHANGELOG.md`，写出本次真实变更与限制，再运行：

```bash
git add terminal-sidebar/install.py terminal-sidebar/register_tool.py
git add terminal-workspace-release/VERSION terminal-workspace-release/GUIDE_VERSION
git add terminal-workspace-release/CHANGELOG.md
python3 tools/check.py --tag v1.2.0-dev.2 --output dist/dev-2
git diff --cached --check
git commit -m "release: 1.2.0-dev.2"
git tag -a v1.2.0-dev.2 -m "TerminalWorkBar 1.2.0-dev.2"
git push origin dev
git push origin v1.2.0-dev.2
```

功能源码变更也必须明确 `git add` 并提交。白名单检查针对 Git 跟踪集合；新增源码文件时同步更新构建器及 `tools/check.py` 的文件定义。不要为通过检查而把个人文件加入白名单。

推送 Tag 触发 `.github/workflows/release.yml`。Tag 提交必须属于远端 `dev`；因此先推分支再推 Tag。发布会标记为 **Pre-release**，不替代稳定版 Latest。

## 4. 发布稳定版

完成 `TESTING.md` 中的 macOS / iTerm2 人工回归后，合并已验证开发线。以下以正式发布 1.2.0 为例：

```bash
git switch main
git pull --ff-only origin main
git merge --no-ff dev
python3 tools/set_version.py 1.2.0 --guide 1.4.0
```

更新 CHANGELOG（删除本次草稿措辞，记录兼容性和已知限制），明确提交版本文件及真实变更：

```bash
git add terminal-sidebar/install.py terminal-sidebar/register_tool.py
git add terminal-workspace-release/VERSION terminal-workspace-release/GUIDE_VERSION
git add terminal-workspace-release/CHANGELOG.md
python3 tools/check.py --tag v1.2.0 --output dist/stable-1.2.0
git diff --cached --check
git commit -m "release: 1.2.0"
git tag -a v1.2.0 -m "TerminalWorkBar 1.2.0 stable"
git push origin main
git push origin v1.2.0
```

稳定 Tag 的提交必须属于远端 `main`。工作流将 Release 标记为非预发布并设为 Latest。首次发布或多个维护版本并行时，应确认这个版本确实是希望推荐的 Latest，不要用旧版本测试稳定发布流程。

发布后把 `main` 合回 `dev`，通过版本工具进入下一开发版本，再继续提交。不要强推重写已发布历史。

## 5. GitHub 自动化与权限

- `ci.yml`：main / dev push，以及目标为这两条分支的 PR；只读仓库权限，校验两个发行包并上传临时 artifact。
- `release.yml`：只响应 `v*` Tag；核对精确版本与分支归属，使用 job 级 `contents: write` 创建 Release。
- 工作流使用 GitHub 自带的短期 `GITHUB_TOKEN`，不需要在仓库存 PAT、SSH 私钥或本机令牌。
- 第三方 Actions 固定到提交 SHA；升级时确认官方仓库、版本变更和新的 SHA，不随意改成未知 Action。
- Release 先建草稿，四个附件全部上传后再公开，避免用户下载半套包。预发布也先建草稿再标记公开。
- 同 Tag 串行执行。失败草稿可重跑上传；已公开版本拒绝覆盖，不自动删除旧资产。

若仓库 / 组织禁用了 Actions，或策略限制写入权限，工作流会失败，需要维护者在 GitHub Settings 中按组织要求处理。不能因上传成功就假定 Release 已完成：到 **Actions** 看检查结果，再到 **Releases** 核对附件和预发布标记。

建议在仓库 Rulesets 中保护 `main`、要求 Source and packages 检查通过，并限制发布 Tag 的修改 / 删除；这些需要仓库管理员配置，本仓库文件本身不会替你开启保护。

## 6. 手动发布或失败恢复

没有 Actions 时，本地 `tools/check.py` 生成同样的四个附件与 `RELEASE_NOTES.md`。在 GitHub Releases 为已推送的 Tag 新建草稿，复制说明，上传两个 ZIP 和各自 `.sha256`；开发 Tag 勾选 Pre-release，不设 Latest；核对后发布。

如果使用已登录的 GitHub CLI，可按同样原则执行 `gh release create --verify-tag --draft`、`gh release upload`，最后 `gh release edit` 公开。不要把 CLI token 写进命令文件或提交到仓库。

失败处理：

- 版本不匹配：修复版本文件并新建提交 / Tag；不移动已经公开的 Tag。
- 分支归属失败：确认分支已推送，Tag 指向正确提交。
- 网络 / 上传失败但 Release 仍是草稿：重跑失败工作流；草稿附件可替换。
- 已公开版本发现问题：发布新的 patch / 预发布版本，不静默替换同版本 ZIP。
- 本地重打包：用新的空目录；历史发布文件保留不覆盖。GitHub Release 包以发布时的摘要为准。

## 7. 包、Tag 和安全边界

同一次 Release 提供：

```text
Terminal-Workspace-<VERSION>-macOS-source.zip
Terminal-Workspace-<VERSION>-macOS-source.zip.sha256
Terminal-Workspace-Guide-<GUIDE_VERSION>.zip
Terminal-Workspace-Guide-<GUIDE_VERSION>.zip.sha256
```

网站与应用版本可不同；网站的 `MANIFEST.json` 同时记录两者。GitHub 自动生成的 Source code ZIP 不是上述白名单应用包，结构不同。

应用包是 **macOS 源码安装包**。Linux Actions 校验源码、构建 ZIP、验证清单；**不代表在 Linux 上运行过 SwiftUI、iTerm2 或真实 tmux 集成**。稳定版仍需 macOS 人工回归；未签名公证，不承诺 Gatekeeper 免确认。

开发版与稳定版共用安装目录和个人配置。没有多版本沙箱，也不自动转换数据来支持降级。备份任务、入口、设置和 TODO 后再体验开发版；降级前阅读 schema / 兼容性说明。安装器默认不覆盖任务与命令，但这不等于所有未来数据格式都能向后兼容。

仓库只允许程序、文档和合成示例。已有工作目录中的私人 TODO、Obsidian 配置、旧本机记录文档和导出目录均不跟踪；`.gitignore` 与源码白名单是两层保护。**不要使用 `git add -f` 绕过**。新增目录时先审查是否含真实服务器、日志、cookie、密码、令牌或个人内容。

## 8. 官方参考

- GitHub CLI Release 创建：<https://cli.github.com/manual/gh_release_create>
- Release 编辑：<https://cli.github.com/manual/gh_release_edit>
- GitHub Actions token：<https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication>
