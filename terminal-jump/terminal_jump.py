#!/usr/bin/env python3
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit


CONFIG = Path.home() / '.config/terminal-jump/commands.json'
STATE = Path.home() / 'Library/Caches/terminal-jump'
IDENTIFIER = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z')

CREATE_SCRIPT = '''on run argv
    tell application "iTerm2"
        activate
        if (count of windows) is 0 then
            set targetWindow to (create window with default profile command (item 1 of argv))
            return id of current session of targetWindow
        else
            tell current window
                set targetTab to (create tab with default profile command (item 1 of argv))
                return id of current session of targetTab
            end tell
        end if
    end tell
end run'''

FOCUS_SCRIPT = '''on run argv
    tell application "iTerm2"
        repeat with targetWindow in windows
            repeat with targetTab in tabs of targetWindow
                repeat with targetSession in sessions of targetTab
                    if id of targetSession is (item 1 of argv) then
                        select targetSession
                        select targetTab
                        set miniaturized of targetWindow to false
                        select targetWindow
                        activate
                        return "found"
                    end if
                end repeat
            end repeat
        end repeat
        return "missing"
    end tell
end run'''


def validate_identifier(identifier):
    if not IDENTIFIER.fullmatch(identifier):
        raise ValueError('命令 ID 只能包含字母、数字、下划线、短横线，且须以字母或数字开头（最多 64 字符）。')
    return identifier


def parse_url(url):
    parts = urlsplit(url)
    if (parts.scheme != 'terminal-jump' or parts.netloc != 'open'
            or parts.query or parts.fragment or not parts.path.startswith('/')):
        raise ValueError('URL 格式必须为 terminal-jump://open/命令ID，不接受命令或参数。')
    return validate_identifier(parts.path[1:])


def load_commands():
    with CONFIG.open() as source:
        commands = json.load(source)
    return validate_commands(commands)


def validate_commands(commands):
    if not isinstance(commands, dict):
        raise ValueError('commands.json 顶层必须是对象。')
    for identifier, entry in commands.items():
        validate_identifier(identifier)
        if not isinstance(entry, dict):
            raise ValueError(f'{identifier}: 配置必须是对象。')
        argv = entry.get('argv')
        if (not isinstance(argv, list) or not argv
                or any(not isinstance(argument, str) or '\0' in argument for argument in argv)
                or not argv[0]):
            raise ValueError(f'{identifier}: argv 必须是非空字符串数组，不能包含 NUL。')
        if 'cwd' in entry and not isinstance(entry['cwd'], str):
            raise ValueError(f'{identifier}: cwd 必须是字符串。')
    return commands


def get_command(identifier):
    commands = load_commands()
    if identifier not in commands:
        raise ValueError(f'未配置命令 {identifier}，请编辑 {CONFIG}')
    return commands[identifier]


def read_state(identifier):
    try:
        with (STATE / f'{identifier}.json').open() as source:
            return json.load(source)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def write_state(identifier, record):
    temporary = STATE / f'{identifier}.{record["token"]}.tmp'
    temporary.write_text(json.dumps(record))
    temporary.replace(STATE / f'{identifier}.json')


def is_running(identifier):
    with (STATE / f'{identifier}.running.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
    return False


def applescript(script, *arguments):
    result = subprocess.run(
        ['/usr/bin/osascript', '-', *arguments], input=script, text=True,
        capture_output=True, timeout=45, check=True,
    )
    return result.stdout.strip()


def open_target(identifier):
    get_command(identifier)
    with (STATE / f'{identifier}.launch.lock').open('a') as launch_lock:
        deadline = time.monotonic() + 50
        while True:
            try:
                fcntl.flock(launch_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('另一启动请求仍在处理中，请检查 iTerm2 或自动化授权弹窗。')
                time.sleep(0.1)
        if is_running(identifier):
            record = read_state(identifier)
            if record.get('session_id') and applescript(FOCUS_SCRIPT, record['session_id']) == 'found':
                print(f'已定位现有终端：{identifier}')
                return
            raise RuntimeError('命令仍在运行，但无法定位对应 iTerm2 标签页；未重复执行命令。请先关闭原连接。')
        token = uuid.uuid4().hex
        command = shlex.join([sys.executable, str(Path(__file__).resolve()), 'run', identifier, token])
        session_id = applescript(CREATE_SCRIPT, command)
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            record = read_state(identifier)
            if record.get('token') == token:
                if record.get('session_id') != session_id:
                    raise RuntimeError('iTerm2 session ID 不匹配，请检查新开的终端。')
                message = '命令已退出，请查看终端输出' if record.get('status') == 'exited' else '已打开终端'
                print(f'{message}：{identifier}')
                return
            time.sleep(0.1)
        raise RuntimeError('已请求打开终端，但命令尚未就绪或已退出，请查看 iTerm2 中的输出。')


def run_target(identifier, token):
    entry = get_command(identifier)
    session_id = os.environ.get('ITERM_SESSION_ID', '').split(':')[-1]
    if not session_id:
        raise RuntimeError('run 只能在 iTerm2 中执行；请使用 open 子命令或点击 URL。')
    exit_code = 1
    with (STATE / f'{identifier}.running.lock').open('a') as running_lock:
        try:
            fcntl.flock(running_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('同一命令已经运行，拒绝重复启动。')
        record = {'token': token, 'session_id': session_id, 'pid': os.getpid(), 'status': 'running'}
        write_state(identifier, record)
        try:
            print(f'Terminal Jump · {identifier}\n{shlex.join(entry["argv"])}\n', flush=True)
            child = subprocess.Popen(entry['argv'], cwd=os.path.expanduser(entry.get('cwd', '~')))
            while True:
                try:
                    exit_code = child.wait()
                    break
                except KeyboardInterrupt:
                    continue
        except OSError as error:
            print(f'无法启动命令：{error}', file=sys.stderr, flush=True)
            exit_code = 127
        finally:
            if read_state(identifier).get('token') == token:
                write_state(identifier, {**record, 'status': 'exited', 'exit_code': exit_code})
    if exit_code:
        print(f'\n命令退出，状态码 {exit_code}。请检查 SSH、网络和 tmux session 名称。', flush=True)
        if sys.stdin.isatty():
            try:
                input('按 Enter 关闭；修复后重新点击链接即可重试。')
            except (EOFError, KeyboardInterrupt):
                pass
    return exit_code


def main():
    os.umask(0o077)
    os.environ['PATH'] = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    parser = argparse.ArgumentParser(description='通过固定 URL 打开或定位 iTerm2 命令标签页。')
    subparsers = parser.add_subparsers(dest='action', required=True)
    subparsers.add_parser('list', help='验证配置并列出链接')
    open_parser = subparsers.add_parser('open', help='打开一个 URL 或命令 ID')
    open_parser.add_argument('target')
    run_parser = subparsers.add_parser('run', help=argparse.SUPPRESS)
    run_parser.add_argument('identifier', type=validate_identifier)
    run_parser.add_argument('token', type=validate_identifier)
    options = parser.parse_args()
    if options.action == 'list':
        for identifier, entry in load_commands().items():
            print(f'{identifier}\n  terminal-jump://open/{identifier}\n  {shlex.join(entry["argv"])}')
    elif options.action == 'open':
        identifier = parse_url(options.target) if ':' in options.target else validate_identifier(options.target)
        open_target(identifier)
    else:
        return run_target(options.identifier, options.token)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        detail = error.stderr if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(f'Terminal Jump: {detail}', file=sys.stderr)
        sys.exit(1)
