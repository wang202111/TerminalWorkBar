#!/usr/bin/env python3
import argparse
import datetime
import fcntl
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import uuid
import markdown_io
import ssh_config


ROOT = Path(__file__).resolve().parent
HOME = Path.home()
DATA = HOME / '.config/terminal-sidebar'
STATE = HOME / 'Library/Caches/terminal-sidebar'
V1 = HOME / 'Library/Application Support/Terminal Jump'
sys.path.insert(0, str(V1))
import config_manager
import terminal_jump


def now():
    return datetime.datetime.now().astimezone().isoformat(timespec='seconds')


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.sidebar-')
    try:
        with os.fdopen(descriptor, 'wb') as destination:
            destination.write(content)
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def text(payload, key, required=False, limit=20000):
    value = payload.get(key, '')
    if not isinstance(value, str) or '\0' in value or len(value) > limit:
        raise ValueError(f'{key} 必须是文本，且长度不超过 {limit}。')
    value = value.strip()
    if required and not value:
        raise ValueError(f'请填写 {key}。')
    return value


def host_value(payload):
    host = text(payload, 'host', True, 200)
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@-]*', host):
        raise ValueError('SSH 主机只能填写别名或 user@host，不能包含空格或命令参数。')
    return host


def tmux_name(payload, key, required=True):
    value = text(payload, key, required, 80)
    if value and not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_-]*', value):
        raise ValueError('tmux 名称只支持字母、数字、下划线和短横线，不能以短横线开头。')
    return value


def remote(host, command):
    result = subprocess.run(
        ['/usr/bin/ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, command],
        capture_output=True, text=True, timeout=18,
    )
    if result.returncode:
        raise ValueError((result.stderr or result.stdout or '远端命令失败')[-3000:])
    return result.stdout


def query_tmux(host):
    try:
        output = remote(host, "LC_ALL=C tmux list-sessions -F '#{session_name}|#{session_windows}|#{session_attached}'")
    except subprocess.TimeoutExpired:
        raise ValueError(f'查询 {host} 超时（18 秒）。请检查网络 / VPN，或在终端确认 ssh {host} 能登录。') from None
    except ValueError as error:
        detail = str(error)
        if detail.strip() == 'no sessions' or 'no server running' in detail or ('error connecting to' in detail and 'No such file or directory' in detail):
            return {'sessions': [], 'message': f'{host} 当前没有运行中的默认 tmux session。可填写新名称并勾选「打开时创建」。'}
        if 'Permission denied' in detail or 'Host key verification failed' in detail:
            hint = f'侧栏查询不弹出密码或主机信任提示。请先在终端运行 ssh {host} 完成登录 / 确认主机，再重试；密码登录需配置密钥或 SSH agent。'
        elif 'not found' in detail and 'tmux' in detail:
            hint = '远端非交互 SSH 环境找不到 tmux，请检查远端安装和 PATH。'
        else:
            hint = f'请检查主机别名、网络 / VPN，并在终端确认 ssh {host} 能登录。'
        raise ValueError(hint + '\n\n原始错误：' + detail) from None
    sessions = []
    for line in output.splitlines():
        parts = line.rsplit('|', 2)
        if len(parts) == 3 and parts[1].isdigit() and parts[2].isdigit():
            sessions.append({'name': parts[0], 'windows': parts[1], 'attached': parts[2]})
    if not sessions:
        raise ValueError('SSH 已返回，但没有识别到 tmux 列表。请检查远端 shell 输出；查询不会自动创建 session。')
    return {'sessions': sessions, 'message': f'{host}：发现 {len(sessions)} 个 session。点击下方名称即可填入。仅查询，未创建或连接。'}


def choose_export_path(folder, filename):
    script = '''on run arguments
    try
        set destination to choose file name with prompt "导出 Markdown：选择新文件名和保存位置（不覆盖已有文件）" default location (POSIX file (item 1 of arguments)) default name (item 2 of arguments)
        return POSIX path of destination
    on error number -128
        return ""
    end try
end run'''
    result = subprocess.run(['/usr/bin/osascript', '-e', script, str(folder), filename], capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise ValueError('无法打开保存对话框；可改用「保存到默认目录」。\n' + result.stderr[-1200:])
    return result.stdout.rstrip('\r\n')


def command_for_tmux(payload):
    host = host_value(payload)
    session = tmux_name(payload, 'session')
    window = tmux_name(payload, 'window', False)
    create = payload.get('create_on_open') is True
    if not create and not window:
        return host, 'tmux -u a -t ' + shlex.quote(session)
    target = "'=" + session + "'"
    commands = ['set -e']
    if create:
        commands.append(f'if ! tmux has-session -t {target} 2>/dev/null; then tmux new-session -d -s {shlex.quote(session)}; fi')
    if window:
        exact_window = "'=" + session + ':=' + window + "'"
        if create:
            commands.append(f'if ! tmux list-windows -t {target} -F "#{{window_name}}" | grep -Fxq -- {shlex.quote(window)}; then tmux new-window -d -t {target} -n {shlex.quote(window)}; fi')
        commands.append(f'tmux select-window -t {exact_window}')
    commands.append(f'exec tmux -u attach-session -t {target}')
    return host, '\n'.join(commands)


def tmux_settings(entry):
    if entry['mode'] != 'ssh':
        return None
    simple = re.fullmatch(r'tmux(?: -u)? (?:a|attach|attach-session) -t ([A-Za-z0-9_][A-Za-z0-9_-]*)', entry['command'])
    if simple:
        return {'host': entry['host'], 'session': simple[1], 'window': '', 'create_on_open': False}
    match = re.search(r"\nexec tmux(?: -u)? attach-session -t '?=([A-Za-z0-9_][A-Za-z0-9_-]*)'?$", entry['command'])
    if not match:
        return None
    window = re.search(r"^tmux select-window -t '?=[^:]+:=([A-Za-z0-9_][A-Za-z0-9_-]*)'?$", entry['command'], re.MULTILINE)
    settings = {'host': entry['host'], 'session': match[1], 'window': window[1] if window else '', 'create_on_open': '\nif ! tmux has-session' in entry['command']}
    try:
        normalized = re.sub(r' -t (=[A-Za-z0-9_-]+(?::=[A-Za-z0-9_-]+)?)(?=\s|$)', lambda target: " -t '" + target[1] + "'", entry['command'])
        normalized = normalized.replace('\nexec tmux attach-session ', '\nexec tmux -u attach-session ')
        legacy = "set -e\nexec tmux -u attach-session -t '=" + settings['session'] + "'"
        if command_for_tmux(settings)[1] == normalized or (not settings['window'] and not settings['create_on_open'] and normalized == legacy):
            return settings
    except ValueError:
        pass
    return None


def todo_outline(source):
    entries = []
    headings = []
    bullets = []
    shortcuts = False
    for line in source.splitlines():
        stripped = line.strip()
        heading = re.match(r'^(#{1,6})\s+(.+)', stripped)
        if heading:
            shortcuts = heading[2] == 'Terminal 快捷入口'
            bullets = []
            if shortcuts:
                headings = []
                continue
            level = len(heading[1])
            while headings and headings[-1][0] >= level:
                headings.pop()
            parent = headings[-1][1] if headings else None
            entries.append({'title': heading[2], 'parent': parent, 'kind': 'group', 'command_id': '', 'done': False})
            headings.append((level, len(entries) - 1))
            continue
        bullet = re.match(r'^[-*]\s+(?:\[([ xX])\]\s+)?(.+)', stripped)
        if not bullet:
            continue
        raw_title = bullet[2]
        indent = len(line.expandtabs(4)) - len(line.expandtabs(4).lstrip())
        if shortcuts:
            if indent == 0 and '[' not in raw_title:
                shortcuts = False
            else:
                continue
        if 'file://' in raw_title or '[[terminal-' in raw_title:
            continue
        while bullets and bullets[-1][0] >= indent:
            bullets.pop()
        parent = bullets[-1][1] if bullets else headings[-1][1] if headings else None
        match = re.search(r'terminal-jump://open/([A-Za-z0-9_-]+)', raw_title)
        title = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', raw_title).strip()
        entries.append({'title': title, 'parent': parent, 'kind': 'task', 'command_id': match[1] if match else '', 'done': bullet[1] in ('x', 'X')})
        bullets.append((indent, len(entries) - 1))
    parents = {entry['parent'] for entry in entries if entry['parent'] is not None}
    for index, entry in enumerate(entries):
        if entry['parent'] is None and index in parents and not entry['command_id']:
            entry['kind'] = 'group'
        parent = entry['parent']
        entry['path'] = (entries[parent]['path'] if parent is not None else []) + [entry['title']]
    return entries


def validate_tree(data):
    if data.get('version') != 2 or not isinstance(data.get('tasks'), list):
        raise ValueError('任务数据格式错误，未覆盖文件。请检查 tasks.json 或备份。')
    nodes = {}
    for task in data['tasks']:
        identifier = task.get('id')
        if not isinstance(identifier, str) or not identifier or identifier in nodes:
            raise ValueError('任务 ID 缺失或重复。')
        nodes[identifier] = task
    resolved = set()
    for identifier in nodes:
        chain = set()
        current = identifier
        while current and current not in resolved:
            if current not in nodes:
                raise ValueError('上级节点不存在，请刷新后重新选择。')
            if current in chain:
                raise ValueError('不能把节点移动到自己或自己的子级下面。')
            chain.add(current)
            current = nodes[current].get('parent_id', '')
            if not isinstance(current, str):
                raise ValueError('上级节点格式错误。')
        resolved.update(chain)
    return data


def tree_rows(tasks):
    children = {}
    for task in tasks:
        children.setdefault(task.get('parent_id', ''), []).append(task)
    pending = [(task, []) for task in reversed(children.get('', []))]
    while pending:
        task, ancestors = pending.pop()
        yield task, ancestors
        pending.extend((child, ancestors + [task['title']]) for child in reversed(children.get(task['id'], [])))


def migrate_tree(data, todo):
    tasks = data['tasks']
    groups = {}
    folders = []
    for task in tasks:
        group = task.get('group') or '收件箱'
        if group not in groups:
            folder = {'id': uuid.uuid4().hex, 'title': group, 'parent_id': '', 'kind': 'group', 'command_id': '', 'done': False, 'notes': [], 'created': now(), 'updated': now()}
            groups[group] = folder
            folders.append(folder)
        task['parent_id'] = groups[group]['id']
        task['kind'] = 'task'
    lookup = {}
    for task in tasks:
        lookup.setdefault((task.get('group') or '收件箱', task['title']), []).append(task)
    mapping = {}
    if todo.exists():
        for index, entry in enumerate(todo_outline(todo.read_text())):
            if entry['parent'] is None:
                if entry['title'] in groups:
                    mapping[index] = groups[entry['title']]['id']
                continue
            matches = lookup.get((entry['path'][0], entry['title']), [])
            if len(matches) == 1 and entry['parent'] in mapping:
                matches[0]['parent_id'] = mapping[entry['parent']]
                mapping[index] = matches[0]['id']
    data.update(version=2, revision=data['revision'] + 1, tasks=folders + tasks, imports=[])
    for task, ancestors in tree_rows(data['tasks']):
        fingerprint = hashlib.sha256(json.dumps(ancestors + [task['title']], ensure_ascii=False).encode()).hexdigest()
        data['imports'].append(fingerprint)
    return validate_tree(data)


class Store:
    def __init__(self, directory, todo):
        self.directory = directory
        self.todo = todo
        self.path = directory / 'tasks.json'
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (directory / 'tasks.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if not self.path.exists():
                atomic_write(self.path, encode({'version': 2, 'revision': 0, 'tasks': [], 'imports': []}))
            else:
                original = self.path.read_bytes()
                data = json.loads(original)
                if data.get('version') == 1:
                    migrated = migrate_tree(data, self.todo)
                    backup = directory / ('tasks.pre-tree-' + uuid.uuid4().hex[:8] + '.json')
                    atomic_write(backup, original)
                    atomic_write(self.path, encode(migrated))

    def read(self):
        return validate_tree(json.loads(self.path.read_text()))

    def mutate(self, payload, action):
        with (self.directory / 'tasks.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            original = self.path.read_bytes()
            data = self.read()
            if payload.get('revision') != data['revision']:
                raise ValueError('任务已在另一窗口更新，请刷新后重试；草稿没有被保存。')
            message = action(data)
            data['revision'] += 1
            validate_tree(data)
            atomic_write(self.path.with_suffix('.json.bak'), original)
            atomic_write(self.path, encode(data))
            return message

    def task(self, data, payload):
        identifier = text(payload, 'id', True, 80)
        for task in data['tasks']:
            if task['id'] == identifier:
                return task
        raise ValueError('任务不存在，请刷新。')

    def save_task(self, payload):
        title = text(payload, 'title', True, 300)
        if 'parent_id' not in payload:
            raise ValueError('面板已升级为多级结构，请重新加载页面后再保存。')
        parent_id = text(payload, 'parent_id', False, 80)
        kind = text(payload, 'kind', False, 20) or 'task'
        if kind not in ('task', 'group'):
            raise ValueError('节点类型必须是任务或目录。')
        command_id = text(payload, 'command_id', False, 64)
        if command_id:
            terminal_jump.get_command(terminal_jump.validate_identifier(command_id))
        def update(data):
            if payload.get('id'):
                task = self.task(data, payload)
            else:
                task = {'id': uuid.uuid4().hex, 'created': now(), 'done': False, 'notes': []}
                data['tasks'].append(task)
            task.update(title=title, parent_id=parent_id, kind=kind, command_id=command_id, updated=now())
            return '任务已保存，未执行命令。'
        return self.mutate(payload, update)

    def delete_task(self, payload):
        if payload.get('confirmed') is not True:
            raise ValueError('删除节点前必须明确确认。')
        scope = text(payload, 'scope', True, 20)
        if scope not in ('node', 'subtree'):
            raise ValueError('请选择只删除本级或删除整棵子树。')
        def update(data):
            task = self.task(data, payload)
            removed = {task['id']}
            if scope == 'subtree':
                children = {}
                for entry in data['tasks']:
                    children.setdefault(entry.get('parent_id', ''), []).append(entry['id'])
                pending = [task['id']]
                while pending:
                    descendants = children.get(pending.pop(), [])
                    removed.update(descendants)
                    pending.extend(descendants)
            note_count = sum(len(entry.get('notes', [])) for entry in data['tasks'] if entry['id'] in removed)
            backup = self.directory / ('tasks.pre-delete-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:8] + '.json')
            atomic_write(backup, self.path.read_bytes())
            if scope == 'node':
                for entry in data['tasks']:
                    if entry.get('parent_id', '') == task['id']:
                        entry.update(parent_id=task.get('parent_id', ''), updated=now())
            data['tasks'] = [entry for entry in data['tasks'] if entry['id'] not in removed]
            return f'已删除 {len(removed)} 个节点和 {note_count} 条记录；' + ('子级已保留并上移。' if scope == 'node' else '所选子树已移除。') + '删除前已自动备份；终端配置、远端 tmux 和原始 Markdown 未改动。'
        return self.mutate(payload, update)

    def complete(self, payload):
        if not isinstance(payload.get('done'), bool):
            raise ValueError('完成状态无效。')
        def update(data):
            self.task(data, payload).update(done=payload['done'], updated=now())
            return '任务状态已更新。'
        return self.mutate(payload, update)

    def add_note(self, payload):
        note = text(payload, 'note', True)
        def update(data):
            task = self.task(data, payload)
            task['notes'].append({'id': uuid.uuid4().hex, 'text': note, 'created': datetime.datetime.now().astimezone().isoformat(timespec='microseconds')})
            task['updated'] = now()
            return '记录已添加。'
        return self.mutate(payload, update)

    def edit_note(self, payload):
        note_id = text(payload, 'note_id', True, 80)
        content = text(payload, 'note', True)
        def update(data):
            task = self.task(data, payload)
            for entry in task['notes']:
                if entry['id'] == note_id:
                    entry.update(text=content, updated=datetime.datetime.now().astimezone().isoformat(timespec='microseconds'))
                    task['updated'] = now()
                    return '记录已修改，已按最新更新时间置顶。'
            raise ValueError('记录不存在或已被移除，请刷新后确认；未覆盖任何记录。')
        return self.mutate(payload, update)

    def import_todo(self, payload):
        candidates = todo_outline(self.todo.read_text())
        def update(data):
            imported = set(data.get('imports', []))
            known = {tuple(ancestors + [task['title']]): task['id'] for task, ancestors in tree_rows(data['tasks'])}
            mapping = {}
            count = 0
            for index, candidate in enumerate(candidates):
                path = tuple(candidate['path'])
                if path in known:
                    mapping[index] = known[path]
                    continue
                fingerprint = hashlib.sha256(json.dumps(candidate['path'], ensure_ascii=False).encode()).hexdigest()
                if fingerprint in imported:
                    continue
                parent = candidate['parent']
                if parent is not None and parent not in mapping:
                    continue
                identifier = uuid.uuid4().hex
                task = {key: candidate[key] for key in ('title', 'kind', 'command_id', 'done')}
                task.update(id=identifier, parent_id=mapping[parent] if parent is not None else '', created=now(), updated=now(), notes=[])
                data['tasks'].append(task)
                mapping[index] = identifier
                known[path] = identifier
                imported.add(fingerprint)
                count += 1
            data['imports'] = sorted(imported)
            return f'已按层级导入 {count} 个新节点；原 TODO.md 未修改。'
        return self.mutate(payload, update)

    def markdown_preview(self, source):
        merged, preview = markdown_io.merge(self.read(), source, tree_rows, validate_tree, now())
        commands = {entry['id'] for entry in config_manager.manage('list', {})['entries']}
        missing = sorted({entry['command_id'] for entry in merged['tasks'] if entry.get('command_id') and entry['command_id'] not in commands})
        preview['warnings'] = ['本机没有以下终端入口，关联会保留但需要另行配置：' + ', '.join(missing)] if missing else []
        return preview

    def import_markdown(self, payload):
        source = markdown_io.checked_text(payload.get('markdown'), 'Markdown', 240000, True)
        def update(data):
            merged, preview = markdown_io.merge(data, source, tree_rows, validate_tree, now())
            data['tasks'] = merged['tasks']
            counts = preview['counts']
            return f'Markdown 已导入：新增 {counts["added"]}，更新 {counts["updated"]}，未变 {counts["unchanged"]}。未删除其他节点，未执行命令。'
        return self.mutate(payload, update)

    def export_preview(self, style='pretty'):
        data = self.read()
        source = markdown_io.serialize(data['tasks'], tree_rows, style)
        outline = [{**task, 'notes': markdown_io.sorted_notes(task.get('notes', [])), 'depth': len(ancestors)} for task, ancestors in tree_rows(data['tasks'])]
        return {'markdown': source, 'revision': data['revision'], 'format': style, 'outline': outline}

    def export(self, output=None, style='pretty', choose=False, revision=None):
        preview = self.export_preview(style)
        if revision is not None and revision != preview['revision']:
            raise ValueError('任务在导出预览后有更新，请关闭导出窗口后重新打开。')
        source = preview['markdown']
        folder = self.todo.parent / 'terminal-sidebar/exports'
        filename = ('工作清单-' if style == 'pretty' else '工作清单-回导-') + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:6] + '.md'
        if choose:
            folder.mkdir(parents=True, exist_ok=True, mode=0o700)
            output = choose_export_path(folder, filename)
            if not output:
                return {'cancelled': True, 'message': '已取消，没有保存文件。'}
            if not Path(output).suffix:
                output += '.md'
            if Path(output).suffix.lower() not in ('.md', '.markdown'):
                raise ValueError('请使用 .md 或 .markdown 文件扩展名。')
        path = Path(output).expanduser().absolute() if output else folder / filename
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            raise ValueError('该文件已经存在，未覆盖。请选择新的文件名。') from None
        with os.fdopen(descriptor, 'w', encoding='utf-8') as destination:
            destination.write(source)
        return {'path': str(path), 'markdown': source}


class Service:
    def __init__(self, store):
        self.store = store

    def snapshot(self):
        catalog = config_manager.manage('list', {})
        entries = [{**entry, 'tmux': tmux_settings(entry)} for entry in catalog['entries']]
        return {**self.store.read(), 'commands': entries, 'command_revision': catalog['revision']}

    def action(self, action, payload):
        if action == 'task':
            message = self.store.save_task(payload)
        elif action == 'task_delete':
            message = self.store.delete_task(payload)
        elif action == 'complete':
            message = self.store.complete(payload)
        elif action == 'note':
            message = self.store.add_note(payload)
        elif action == 'note_edit':
            message = self.store.edit_note(payload)
        elif action == 'import':
            message = self.store.import_todo(payload)
        elif action == 'export':
            destination = text(payload, 'destination', False, 20) or 'vault'
            if destination not in ('vault', 'choose'):
                raise ValueError('未知导出位置。')
            return {'message': 'Markdown 已保存，没有覆盖已有文件。', **self.store.export(style=text(payload, 'format', False, 20) or 'pretty', choose=destination == 'choose', revision=payload.get('revision'))}
        elif action == 'export_preview':
            return self.store.export_preview(text(payload, 'format', False, 20) or 'pretty')
        elif action == 'markdown_source':
            return {'markdown': self.store.todo.read_text(encoding='utf-8-sig')}
        elif action == 'markdown_preview':
            return self.store.markdown_preview(markdown_io.checked_text(payload.get('markdown'), 'Markdown', 240000, True))
        elif action == 'markdown_import':
            message = self.store.import_markdown(payload)
        elif action == 'open':
            identifier = terminal_jump.validate_identifier(text(payload, 'command_id', True, 64))
            result = subprocess.run([sys.executable, str(V1 / 'terminal_jump.py'), 'open', identifier], capture_output=True, text=True, timeout=110)
            if result.returncode:
                raise ValueError(result.stderr[-3000:])
            message = result.stdout.strip()
        elif action == 'open_v1':
            subprocess.run(['/usr/bin/open', str(HOME / 'Applications/Terminal Jump.app')], check=True)
            return {'message': '已打开原版配置 App。'}
        elif action == 'tmux_list':
            host = host_value(payload)
            return query_tmux(host)
        elif action == 'ssh_hosts':
            return ssh_config.list_hosts()
        elif action == 'tmux_create':
            if payload.get('confirmed') is not True:
                raise ValueError('创建远端 tmux 前必须明确确认。')
            host = host_value(payload)
            session = tmux_name(payload, 'session')
            remote(host, 'tmux new-session -d -s ' + shlex.quote(session))
            return {'message': f'已在 {host} 创建独立 tmux session：{session}。尚未连接。'}
        elif action == 'command':
            mode = text(payload, 'mode', True, 20)
            request = dict(payload)
            request['revision'] = payload.get('command_revision')
            request['original_id'] = text(payload, 'original_id', False, 64)
            if mode == 'tmux':
                host, command = command_for_tmux(payload)
                request.update(mode='ssh', host=host, command=command)
                if not request.get('id'):
                    request['id'] = 'v2-' + re.sub('[^A-Za-z0-9_-]', '-', host)[:20] + '-' + tmux_name(payload, 'session')[:25] + '-' + uuid.uuid4().hex[:5]
            elif mode not in ('ssh', 'shell'):
                raise ValueError('未知命令模式。')
            result = config_manager.manage('save', request)
            message = '入口已更新（第一版同步更新），原有链接 ID 不变；正在运行的终端未改变。' if request['original_id'] else '入口已保存，第一版也可使用；未执行或创建远端进程。'
            return {'message': message, 'created_command': result['changed'][0], **self.snapshot()}
        elif action == 'command_delete':
            if payload.get('confirmed') is not True:
                raise ValueError('删除终端入口前必须确认。')
            identifier = terminal_jump.validate_identifier(text(payload, 'id', True, 64))
            config_manager.manage('delete', {'id': identifier, 'revision': payload.get('command_revision')})
            return {'message': '终端入口已删除（第一版同步删除）。未关闭终端，未删除任务或记录；原关联保留为失效链接，可重新关联。', **self.snapshot()}
        else:
            raise ValueError('未知操作。')
        return {'message': message, **self.snapshot()}


class Handler(BaseHTTPRequestHandler):
    server_version = 'TerminalSidebar'

    def log_message(self, format, *args):
        pass

    def send(self, status, content, content_type='application/json; charset=utf-8'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        self.end_headers()
        self.wfile.write(content)

    def authorized(self):
        expected = f'127.0.0.1:{self.server.server_port}'
        origin = self.headers.get('Origin')
        return (self.headers.get('Host') == expected
                and (origin is None or origin == 'http://' + expected)
                and hmac.compare_digest(self.headers.get('X-Sidebar-Token', ''), self.server.token))

    def do_GET(self):
        path = urlsplit(self.path).path
        expected_host = f'127.0.0.1:{self.server.server_port}'
        if self.headers.get('Host') != expected_host:
            self.send(403, encode({'error': '不允许此 Host。'}))
            return
        if path == '/api/state':
            if not self.authorized():
                self.send(403, encode({'error': '缺少有效访问令牌。'}))
                return
            try:
                self.send(200, encode(self.server.service.snapshot()))
            except (OSError, ValueError) as error:
                self.send(500, encode({'error': str(error)}))
            return
        prefix = '/ui/' + self.server.token + '/'
        files = {'': ('index.html', 'text/html; charset=utf-8'), 'app.js': ('app.js', 'text/javascript; charset=utf-8'), 'style.css': ('style.css', 'text/css; charset=utf-8')}
        if not path.startswith(prefix) or path[len(prefix):] not in files:
            self.send(404, b'Not found', 'text/plain')
            return
        filename, content_type = files[path[len(prefix):]]
        self.send(200, (ROOT / 'static' / filename).read_bytes(), content_type)

    def do_POST(self):
        if not self.authorized():
            self.send(403, encode({'error': '请求来源或访问令牌无效。'}))
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > 262144 or self.headers.get_content_type() != 'application/json':
                raise ValueError('请求必须为不超过 256 KB 的 JSON。')
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('请求必须是 JSON 对象。')
            path = urlsplit(self.path).path
            if not re.fullmatch(r'/api/[a-z_]+', path):
                raise ValueError('无效 API 路径。')
            result = self.server.service.action(path.rsplit('/', 1)[-1], payload)
            self.send(200, encode(result))
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            self.send(400, encode({'error': str(error)}))


def read_runtime():
    try:
        return json.loads((STATE / 'runtime.json').read_text())
    except (FileNotFoundError, ValueError):
        return {}


def healthy(runtime):
    try:
        request = urllib.request.Request(runtime['origin'] + '/api/state', headers={'X-Sidebar-Token': runtime['token']})
        with urllib.request.urlopen(request, timeout=2) as response:
            return response.status == 200
    except (KeyError, OSError, urllib.error.URLError):
        return False


def start():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE / 'start.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        runtime = read_runtime()
        if healthy(runtime):
            return runtime
        with (STATE / 'server.log').open('ab') as log:
            subprocess.Popen([sys.executable, str(ROOT / 'sidebar.py'), 'serve'], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        for attempt in range(50):
            time.sleep(0.1)
            runtime = read_runtime()
            if healthy(runtime):
                return runtime
        raise RuntimeError(f'侧栏服务未就绪，请查看 {STATE / "server.log"}')


def serve():
    with (STATE / 'server.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        settings = json.loads((ROOT / 'settings.json').read_text())
        DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
        token_file = DATA / 'token'
        if not token_file.exists():
            atomic_write(token_file, secrets.token_urlsafe(32).encode())
        token = token_file.read_text().strip()
        previous = read_runtime()
        port = previous.get('port', 0)
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
        except OSError:
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        server.token = token
        server.service = Service(Store(DATA, Path(settings['todo'])))
        origin = f'http://127.0.0.1:{server.server_port}'
        atomic_write(STATE / 'runtime.json', encode({'pid': os.getpid(), 'port': server.server_port, 'origin': origin, 'token': token, 'url': origin + '/ui/' + token + '/'}))
        server.serve_forever()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'serve', 'status', 'open', 'browser', 'stop', 'export', 'import'])
    parser.add_argument('file', nargs='?')
    parser.add_argument('--apply', action='store_true', help='明确应用 Markdown 导入；默认只预览')
    parser.add_argument('--format', choices=['pretty', 'roundtrip'], default='pretty', help='导出格式：清爽层级 / 保留 ID 回导')
    arguments = parser.parse_args()
    action = arguments.action
    if arguments.apply and action != 'import':
        parser.error('--apply 仅用于 import')
    if arguments.file and action not in ('export', 'import'):
        parser.error('此操作不接受文件参数')
    if action in ('export', 'import'):
        settings = json.loads((ROOT / 'settings.json').read_text())
        store = Store(DATA, Path(settings['todo']))
        if action == 'export':
            print(store.export(arguments.file, style=arguments.format)['path'])
        else:
            if not arguments.file:
                parser.error('import 需要 Markdown 文件路径')
            source = Path(arguments.file).expanduser().read_text(encoding='utf-8-sig')
            preview = store.markdown_preview(source)
            print(json.dumps(preview, ensure_ascii=False, indent=2))
            if arguments.apply:
                print(store.import_markdown({'revision': preview['revision'], 'markdown': source}))
            else:
                print('仅预览，没有修改。确认后添加 --apply 重新执行。')
    elif action == 'serve':
        serve()
    elif action == 'status':
        runtime = read_runtime()
        print('running' if healthy(runtime) else 'stopped')
    elif action == 'stop':
        runtime = read_runtime()
        if healthy(runtime):
            os.kill(runtime['pid'], signal.SIGTERM)
            print('侧栏服务已停止，第一版不受影响。')
    else:
        runtime = start()
        if action == 'start':
            print('侧栏服务已启动。')
        elif action == 'browser':
            subprocess.run(['/usr/bin/open', runtime['url']], check=True)
        else:
            result = subprocess.run([sys.executable, str(ROOT / 'register_tool.py'), runtime['url']], capture_output=True, text=True, timeout=50)
            if result.returncode:
                raise RuntimeError('侧栏网页服务已就绪，但注册或显示 iTerm2 Toolbelt 失败。请确认 Python API 已开启、脚本已获授权、当前终端窗口可用。也可运行 terminal-sidebar browser 先试用。\n' + (result.stderr or result.stdout)[-1800:])
            print(result.stdout.strip() or 'Terminal Sidebar 已显示。')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
