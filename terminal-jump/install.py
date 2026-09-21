#!/usr/bin/env python3
import os
import json
from pathlib import Path
import platform
import plistlib
import shlex
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent
HOME = Path.home()
SUPPORT = HOME / 'Library/Application Support/Terminal Jump'
APP = HOME / 'Applications/Terminal Jump.app'
CONFIG = HOME / '.config/terminal-jump/commands.json'
CLI = HOME / '.local/bin/terminal-jump'


def compiler_options(temporary):
    compiler = Path(subprocess.check_output(['/usr/bin/xcrun', '--find', 'swiftc'], text=True).strip())
    headers = compiler.parent.parent / 'include/swift'
    legacy = headers / 'module.modulemap'
    current = headers / 'bridging.modulemap'
    if (legacy.exists() and current.exists()
            and 'module SwiftBridging' in legacy.read_text()
            and 'module SwiftBridging' in current.read_text()):
        empty = Path(temporary) / 'empty.modulemap'
        empty.write_text('')
        overlay = Path(temporary) / 'compiler-overlay.json'
        overlay.write_text(json.dumps({'version': 0, 'roots': [{
            'type': 'file', 'name': str(legacy), 'external-contents': str(empty),
        }]}))
        print('检测到重复 SwiftBridging 模块，仅通过临时编译视图屏蔽旧定义；不修改系统文件。', flush=True)
        return ['-vfsoverlay', str(overlay), '-Xcc', '-ivfsoverlay', '-Xcc', str(overlay)]
    return []


def main():
    os.umask(0o077)
    if not Path('/Applications/iTerm.app').exists():
        raise RuntimeError('请先将 iTerm2 安装到 /Applications/iTerm.app。')
    for folder in (SUPPORT, APP.parent, CONFIG.parent, CLI.parent):
        folder.mkdir(parents=True, exist_ok=True)
    if APP.exists():
        with (APP / 'Contents/Info.plist').open('rb') as source:
            if plistlib.load(source).get('CFBundleIdentifier') != 'local.terminal-jump.launcher':
                raise RuntimeError(f'拒绝覆盖不属于本工具的应用：{APP}')
    shutil.copy2(ROOT / 'terminal_jump.py', SUPPORT / 'terminal_jump.py')
    shutil.copy2(ROOT / 'config_manager.py', SUPPORT / 'config_manager.py')
    if not CONFIG.exists():
        with CONFIG.open('x', encoding='utf-8') as destination:
            destination.write('{}\n')
        CONFIG.chmod(0o600)
    interpreter = str(Path(sys.executable).resolve())
    invocation = shlex.join([interpreter, str(SUPPORT / 'terminal_jump.py')])
    CLI.write_text('#!/bin/sh\nexec ' + invocation + ' "$@"\n')
    CLI.chmod(0o700)
    with tempfile.TemporaryDirectory() as temporary:
        staged_app = Path(temporary) / APP.name
        executable_dir = staged_app / 'Contents/MacOS'
        resources = staged_app / 'Contents/Resources'
        executable_dir.mkdir(parents=True)
        resources.mkdir()
        subprocess.run([
            '/usr/bin/swiftc', '-O', '-target', f'{platform.machine()}-apple-macos14.0',
            *compiler_options(temporary),
            str(ROOT / 'TerminalJump.swift'), '-o', str(executable_dir / 'TerminalJump'),
        ], check=True)
        (resources / 'runtime.json').write_text(json.dumps({
            'python': interpreter,
            'launcher': str(SUPPORT / 'terminal_jump.py'),
            'manager': str(SUPPORT / 'config_manager.py'),
        }))
        plist_path = staged_app / 'Contents/Info.plist'
        metadata = {
            'CFBundleIdentifier': 'local.terminal-jump.launcher',
            'CFBundleName': 'Terminal Jump',
            'CFBundleExecutable': 'TerminalJump',
            'CFBundlePackageType': 'APPL',
            'CFBundleShortVersionString': '2.0.0',
            'CFBundleVersion': '2',
            'LSMinimumSystemVersion': '14.0',
            'NSHighResolutionCapable': True,
            'LSUIElement': True,
            'NSAppleEventsUsageDescription': '打开或定位你配置的 iTerm2 终端标签页。',
            'CFBundleURLTypes': [{
                'CFBundleURLName': 'Terminal Jump Command',
                'CFBundleURLSchemes': ['terminal-jump'],
                'CFBundleTypeRole': 'Viewer',
            }],
        }
        with plist_path.open('wb') as destination:
            plistlib.dump(metadata, destination)
        subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(staged_app)], check=True)
        if APP.exists():
            shutil.rmtree(APP)
        shutil.copytree(staged_app, APP)
    subprocess.run([
        '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
        '-f', str(APP),
    ], check=True)
    subprocess.run([interpreter, str(SUPPORT / 'terminal_jump.py'), 'list'], check=True)
    print(f'\n安装完成。\n应用：{APP}\n配置：{CONFIG}\n命令行：{CLI}')


if __name__ == '__main__':
    main()
