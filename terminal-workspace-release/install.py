#!/usr/bin/env python3
import argparse
from pathlib import Path
import platform
import plistlib
import subprocess
import sys


ROOT = Path(__file__).resolve().parent
SOURCE_ROOT = ROOT if (ROOT / 'terminal-sidebar').is_dir() else ROOT.parent
HOME = Path.home()


def launcher_installed():
    support = HOME / 'Library/Application Support/Terminal Jump'
    application = HOME / 'Applications/Terminal Jump.app'
    if application.exists():
        with (application / 'Contents/Info.plist').open('rb') as source:
            if plistlib.load(source).get('CFBundleIdentifier') != 'local.terminal-jump.launcher':
                raise RuntimeError('同名 Terminal Jump.app 不属于本工具，拒绝覆盖。')
    return application.exists() and all((support / name).exists() for name in ('terminal_jump.py', 'config_manager.py'))


def preflight(upgrade_launcher=False):
    if platform.system() != 'Darwin' or tuple(int(part) for part in (platform.mac_ver()[0].split('.') + ['0'])[:2]) < (14, 0):
        raise RuntimeError('需要 macOS 14 或更新版本。')
    if sys.version_info < (3, 11):
        raise RuntimeError('需要 Python 3.11 或更新版本，请参见 INSTALL.md。')
    if not Path('/Applications/iTerm.app').exists():
        raise RuntimeError('请先把 iTerm2 安装到 /Applications/iTerm.app。')
    installed = launcher_installed()
    if not installed or upgrade_launcher:
        selected = subprocess.run(['/usr/bin/xcode-select', '-p'], capture_output=True, text=True)
        if selected.returncode:
            raise RuntimeError('首次构建需要 Apple Command Line Tools。请先运行 xcode-select --install，安装完成后重试。')
        compiler = subprocess.run(['/usr/bin/xcrun', '--find', 'swiftc'], capture_output=True, text=True)
        if compiler.returncode:
            raise RuntimeError('未找到 Swift 编译器，请检查 Command Line Tools。')
    print('环境检查通过。安装只使用本机源码；Python SDK 依赖需联网下载。')
    return installed


def main():
    parser = argparse.ArgumentParser(description='Terminal Workspace：安装或升级，默认保留全部个人数据。')
    parser.add_argument('--check', action='store_true', help='只检查安装条件，不修改文件')
    parser.add_argument('--todo', help='可选：指定自己的 TODO.md，不覆盖已有内容')
    parser.add_argument('--upgrade-launcher', action='store_true', help='显式重新编译已有 Terminal Jump；配置仍保留')
    parser.add_argument('--no-start', action='store_true', help='安装后不启动本机服务')
    arguments = parser.parse_args()
    installed = preflight(arguments.upgrade_launcher)
    if arguments.check:
        return
    if not installed or arguments.upgrade_launcher:
        subprocess.run([sys.executable, str(SOURCE_ROOT / 'terminal-jump/install.py')], check=True)
    else:
        print('保留已有 Terminal Jump App 和命令配置。')
    previous = HOME / '.local/bin/terminal-sidebar'
    if previous.exists():
        subprocess.run([str(previous), 'stop'], check=True, timeout=15)
    command = [sys.executable, str(SOURCE_ROOT / 'terminal-sidebar/install.py')]
    if arguments.todo:
        command.extend(['--todo', arguments.todo])
    if arguments.no_start:
        command.append('--no-start')
    subprocess.run(command, check=True)
    print('\n安装完成。下一步：')
    print('1. 打开 iTerm2 设置，搜索并启用 Python API。')
    print('2. 双击 ~/Applications/Terminal Sidebar.app，首次连接按提示授权。')
    print('3. 添加任务和终端入口；SSH 主机可以从本机配置选择。')
    print('没有导入示例，没有修改已有任务、命令或 SSH 配置。详见 INSTALL.md。')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print('安装未完成：' + str(error), file=sys.stderr)
        sys.exit(1)
