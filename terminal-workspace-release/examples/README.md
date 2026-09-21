# 示例：全部是虚构数据

本目录不会被安装器自动导入。主机使用保留的 `.invalid` 域名，不对应真实服务器；不要直接用示例主机做 SSH 连接。

| 文件 | 用途 |
| --- | --- |
| `tasks.md` | 漂亮的层级 Markdown，用于阅读 |
| `tasks.roundtrip.md` | 保留固定示例 ID、类型和记录时间，适合导入 / 改名 / 移动练习 |
| `tasks.example.json` | 任务 schema 参考，不要覆盖自己的 `tasks.json` |
| `commands.example.json` | 命令配置结构参考，不要覆盖自己的命令配置 |
| `ssh-config.example` | SSH Host 别名语法示例，不要覆盖自己的 `~/.ssh/config` |

## 安全试用流程

1. 安装完成后，在「终端入口」新增一个**本地 Shell**入口。
2. 名称填“示例：本地输出”，ID 填 `demo-shell`，命令填：

   ```bash
   printf 'Demo terminal\n'
   ```

3. 保存入口，不执行。
4. 用「导入 Markdown」选择 `tasks.roundtrip.md`，检查预览，再明确确认。
5. 导入提示缺少 `demo-ssh` 是正常的。可以先不配置远端入口，不影响本地任务示例。
6. 点击“检查本地环境”的终端按钮，只会运行你刚刚保存的输出命令。

如果已有 `demo-shell` / `demo-ssh` 入口，不要覆盖它们；改用新的 ID，并相应修改示例 Markdown 链接。

## 不使用界面导入

在发布包根目录执行：

```bash
~/.local/bin/terminal-sidebar import examples/tasks.roundtrip.md
~/.local/bin/terminal-sidebar import examples/tasks.roundtrip.md --apply
```

第一条只预览，第二条才修改你的本机任务列表。任何示例都不会自动创建 SSH、tmux 或命令配置。

## 练习修改与清理

- 保留 `ts-node` 注释中的 ID，只改标题；重新导入应显示更新而不是新增。
- 修改整棵子树的缩进，预览移动后的层级。
- 删除文件中的整个节点不会从 UI 删除它；真正删除需在 UI 显式确认。
- 练习结束后，可以在 UI 删除“示例项目 Alpha”和“示例发布检查”两棵示例子树。
- 任务删除不会删除 `demo-shell` 入口；需要清理入口时再去“终端入口”页确认删除。

不要直接用 JSON 示例覆盖真实数据文件。示例中的固定 ID 如与你已有 ID 冲突，应停止导入并修改示例 ID。
