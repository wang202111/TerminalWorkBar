#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path
import plistlib
import shlex
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent
HOME = Path.home()
SUPPORT = HOME / 'Library/Application Support/Terminal Sidebar'
APP = HOME / 'Applications/Terminal Sidebar.app'
CLI = HOME / '.local/bin/terminal-sidebar'
SCRIPTS = HOME / 'Library/Application Support/iTerm2/Scripts'


def apple_string(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def configure_settings(todo=None):
    settings = SUPPORT / 'settings.json'
    if settings.exists():
        current = json.loads(settings.read_text())
        if not isinstance(current, dict) or not isinstance(current.get('todo'), str):
            raise ValueError('已有 settings.json 格式无效，未覆盖。请先备份并检查。')
        if todo is None:
            return
    else:
        current = {}
    destination = Path(todo).expanduser().absolute() if todo else HOME / 'Documents/Terminal Workspace/TODO.md'
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        with destination.open('x', encoding='utf-8') as output:
            output.write('# 工作清单\n')
    current['todo'] = str(destination)
    with tempfile.NamedTemporaryFile(mode='w', dir=SUPPORT, encoding='utf-8', delete=False) as output:
        temporary = Path(output.name)
        json.dump(current, output, ensure_ascii=False)
    try:
        os.replace(temporary, settings)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description='安装侧栏；保留已有任务、终端配置和 TODO 路径。')
    parser.add_argument('--todo', help='指定已有或新的 TODO.md；不导入、不覆盖其内容')
    parser.add_argument('--no-start', action='store_true', help='安装后不启动本机服务')
    arguments = parser.parse_args()
    if sys.version_info < (3, 11):
        raise RuntimeError('本发行版需要 Python 3.11 或更新版本。')
    v1 = HOME / 'Library/Application Support/Terminal Jump'
    if not (v1 / 'config_manager.py').exists():
        raise RuntimeError('请先安装第一版 Terminal Jump；第二版不会替换它。')
    for folder in (SUPPORT, APP.parent, CLI.parent, SCRIPTS):
        folder.mkdir(parents=True, exist_ok=True)
    python = SUPPORT / 'venv/bin/python'
    if not python.exists():
        subprocess.run([sys.executable, '-m', 'venv', str(SUPPORT / 'venv')], check=True)
    subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check', 'iterm2==2.24', 'websockets==17.1', 'protobuf==7.36.2'], check=True)
    for filename in ('sidebar.py', 'register_tool.py', 'markdown_io.py', 'ssh_config.py'):
        shutil.copy2(ROOT / filename, SUPPORT / filename)
    shutil.copytree(ROOT / 'static', SUPPORT / 'static', dirs_exist_ok=True)
    configure_settings(arguments.todo)
    invocation = shlex.join([str(python), str(SUPPORT / 'sidebar.py')])
    CLI.write_text('#!/bin/sh\nexec ' + invocation + ' "$@"\n')
    CLI.chmod(0o700)
    source = f'''on run
    try
        do shell script {apple_string(invocation + ' open')}
    on error errorMessage
        set choice to display dialog errorMessage with title "Terminal Sidebar · V2" buttons {{"关闭", "先在浏览器试用"}} default button "关闭"
        if button returned of choice is "先在浏览器试用" then
            do shell script {apple_string(invocation + ' browser')}
        end if
    end try
end run
'''
    if APP.exists():
        with (APP / 'Contents/Info.plist').open('rb') as source_file:
            if plistlib.load(source_file).get('CFBundleIdentifier') != 'local.terminal-sidebar.app':
                raise RuntimeError('同名 App 不属于本工具，拒绝覆盖。')
    with tempfile.TemporaryDirectory() as temporary:
        script = Path(temporary) / 'sidebar.applescript'
        script.write_text(source)
        staged = Path(temporary) / APP.name
        subprocess.run(['/usr/bin/osacompile', '-o', str(staged), str(script)], check=True)
        info = staged / 'Contents/Info.plist'
        with info.open('rb') as source_file:
            metadata = plistlib.load(source_file)
        metadata.update({'CFBundleIdentifier': 'local.terminal-sidebar.app', 'CFBundleName': 'Terminal Sidebar',
                         'CFBundleShortVersionString': '1.2.0', 'LSUIElement': True,
                         'NSAppleEventsUsageDescription': '注册 iTerm2 任务侧栏并定位已配置的终端。'})
        with info.open('wb') as destination:
            plistlib.dump(metadata, destination)
        subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(staged)], check=True)
        if APP.exists():
            shutil.rmtree(APP)
        shutil.copytree(staged, APP)
        subprocess.run(['/usr/bin/osacompile', '-o', str(SCRIPTS / 'Terminal Sidebar.scpt'), str(script)], check=True)
    subprocess.run(['/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', '-f', str(APP)], check=True)
    if not arguments.no_start:
        subprocess.run([str(python), str(SUPPORT / 'sidebar.py'), 'start'], check=True)
    print(f'\n独立安装完成：{APP}\n命令行：{CLI}\n第一版 App 和已有命令未修改。')


if __name__ == '__main__':
    main()
