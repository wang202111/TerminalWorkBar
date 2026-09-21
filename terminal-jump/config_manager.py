#!/usr/bin/env python3
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import sys
import tempfile
import uuid

import terminal_jump


def catalog(commands, content):
    entries = []
    for identifier, entry in commands.items():
        argv = entry['argv']
        remote = len(argv) == 4 and argv[0] in ('ssh', '/usr/bin/ssh') and argv[1] == '-t'
        shell = len(argv) == 3 and argv[:2] == ['/bin/zsh', '-lc']
        entries.append({
            'id': identifier, 'title': entry.get('title', identifier),
            'mode': 'ssh' if remote else 'shell',
            'host': argv[2] if remote else '',
            'command': argv[3] if remote else argv[2] if shell else shlex.join(argv),
            'cwd': entry.get('cwd', ''),
        })
    return {'entries': entries, 'revision': hashlib.sha256(content).hexdigest()}


def text(payload, key, default=''):
    value = payload.get(key, default)
    if not isinstance(value, str) or '\0' in value:
        raise ValueError(f'{key} 必须是文本，且不能包含 NUL。')
    return value


def make_identifier(raw, title, commands):
    if raw:
        return terminal_jump.validate_identifier(raw)
    base = re.sub(r'[^a-zA-Z0-9_-]+', '-', title).strip('-_')[:48]
    if not base:
        base = 'cmd-' + uuid.uuid4().hex[:8]
    candidate = base
    suffix = 2
    while candidate in commands:
        candidate = f'{base}-{suffix}'
        suffix += 1
    return terminal_jump.validate_identifier(candidate)


def make_entry(payload, previous=None):
    command = text(payload, 'command').strip()
    if not command:
        raise ValueError('请输入要执行的指令。')
    mode = text(payload, 'mode', 'shell')
    if mode == 'ssh':
        host = text(payload, 'host').strip()
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@-]*', host):
            raise ValueError('SSH 主机请填写别名或 user@host；不要填写 ssh、空格或参数。')
        argv = ['/usr/bin/ssh', '-t', host, command]
    elif mode == 'shell':
        argv = ['/bin/zsh', '-lc', command]
    else:
        raise ValueError('未知命令类型。')
    entry = dict(previous or {})
    if previous:
        prior = catalog({'original': previous}, b'')['entries'][0]
        if all(payload.get(key, '') == prior[key] for key in ('mode', 'host', 'command')):
            argv = previous['argv']
    entry.update({'argv': argv, 'title': text(payload, 'title').strip()})
    cwd = text(payload, 'cwd').strip()
    if cwd:
        if not os.path.isabs(os.path.expanduser(cwd)):
            raise ValueError('工作目录必须是绝对路径或以 ~/ 开头。')
        entry['cwd'] = cwd
    else:
        entry.pop('cwd', None)
    return entry


def atomic_write(path, content):
    descriptor, temporary = tempfile.mkstemp(prefix='.commands-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as destination:
            destination.write(content)
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def manage(action, payload):
    config = terminal_jump.CONFIG
    with config.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        original = config.read_bytes()
        commands = terminal_jump.validate_commands(json.loads(original))
        result = catalog(commands, original)
        if action == 'list':
            return result
        if payload.get('revision') != result['revision']:
            raise ValueError('配置已在其他位置修改。请先刷新列表，再重新编辑；未覆盖任何配置。')
        changed = []
        if action == 'save':
            identifier = make_identifier(text(payload, 'id').strip(), text(payload, 'title'), commands)
            original_id = text(payload, 'original_id')
            if original_id and (original_id != identifier or original_id not in commands):
                raise ValueError('已有命令的 ID 不可更改，请新建命令以保留旧链接。')
            if not original_id and identifier in commands:
                raise ValueError(f'ID {identifier} 已存在，请换一个 ID 或从左侧选择后编辑。')
            entry = make_entry(payload, commands.get(original_id))
            entry['title'] = entry['title'] or identifier
            commands[identifier] = entry
            changed.append(identifier)
        elif action == 'batch':
            for line_number, line in enumerate(text(payload, 'text').splitlines(), 1):
                line = line.strip()
                if not line:
                    continue
                raw_id, separator, command = line.partition(' :: ')
                if not separator:
                    raw_id, command = '', line
                identifier = make_identifier(raw_id.strip(), '', commands)
                if identifier in commands:
                    raise ValueError(f'第 {line_number} 行：ID {identifier} 已存在，整批未保存。')
                entry = make_entry({'mode': 'shell', 'command': command, 'title': identifier})
                commands[identifier] = entry
                changed.append(identifier)
            if not changed:
                raise ValueError('请至少输入一条命令。')
        elif action == 'delete':
            identifier = terminal_jump.validate_identifier(text(payload, 'id'))
            if identifier not in commands:
                raise ValueError('该命令不存在。')
            del commands[identifier]
        else:
            raise ValueError('未知操作。')
        terminal_jump.validate_commands(commands)
        content = (json.dumps(commands, ensure_ascii=False, indent=2) + '\n').encode()
        if config.read_bytes() != original:
            raise ValueError('配置刚刚被其他程序修改，未保存。请刷新后重试。')
        atomic_write(config.with_suffix('.json.bak'), original)
        atomic_write(config, content)
        return {**catalog(commands, content), 'changed': changed}


if __name__ == '__main__':
    os.umask(0o077)
    try:
        action = sys.argv[1] if len(sys.argv) > 1 else 'list'
        payload = {} if action == 'list' else json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError('请求必须是 JSON 对象。')
        print(json.dumps(manage(action, payload), ensure_ascii=False))
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
