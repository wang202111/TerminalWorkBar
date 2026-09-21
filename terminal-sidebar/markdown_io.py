import copy
import datetime
import html
import json
import re
import uuid


HEADER = '<!-- terminal-sidebar: {"format":1} -->'
IDENTIFIER = r'[A-Za-z0-9_-]{1,80}'
COMMAND = r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}'


def metadata(label, value):
    encoded = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return '<!-- ' + label + ': ' + encoded.replace('<', '\\u003c').replace('>', '\\u003e') + ' -->'


def sorted_notes(notes):
    def timestamp(note):
        for value in (note.get('updated'), note.get('created')):
            try:
                parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=datetime.timezone.utc)
                return parsed.timestamp()
            except (AttributeError, ValueError, TypeError, OverflowError, OSError):
                continue
        return 0
    return sorted(notes, key=timestamp, reverse=True)


def escape_title(value):
    escaped = html.escape(value, quote=False).replace('\n', '&#10;').replace('\r', '&#13;').replace('/', '&#47;').replace(':', '&#58;')
    return re.sub(r'([\\`*_{}\[\]()#+.!|~>-])', r'\\\1', escaped)


def decode_title(value):
    return html.unescape(re.sub(r'\\([\\`*_{}\[\]()#+.!|~>-])', r'\1', value.strip()))


def readable_title(value):
    escaped = html.escape(value, quote=False).replace('\n', ' ').replace('\r', ' ')
    escaped = escaped.replace('terminal-jump://', 'terminal-jump&#58;//').replace('ts-node:', 'ts-node&#58;')
    return re.sub(r'([\\`*_\[\]])', r'\\\1', escaped)


def serialize_pretty(tasks, rows):
    lines = ['# Terminal Sidebar 工作清单', '']
    for task, ancestors in rows(tasks):
        if not ancestors and len(lines) > 2:
            lines.append('')
        indent = '    ' * len(ancestors)
        title = readable_title(task['title'])
        terminal = f' · [打开终端](terminal-jump://open/{task["command_id"]})' if task.get('command_id') else ''
        label = f'**{title}**' if task.get('kind') == 'group' else ('[x] ' if task.get('done') else '[ ] ') + title
        lines.append(f'{indent}- {label}{terminal}')
        for note in sorted_notes(task.get('notes', [])):
            lines.append('')
            lines.extend(indent + '    > ' + line for line in note['text'].split('\n'))
            lines.append('')
    return '\n'.join(lines).rstrip() + '\n'


def serialize(tasks, rows, style='roundtrip'):
    if style == 'pretty':
        return serialize_pretty(tasks, rows)
    if style != 'roundtrip':
        raise ValueError('未知导出格式。')
    lines = [HEADER, '# Terminal Sidebar 工作清单', '', '编辑缩进可移动节点；保留 ts-node ID 可改名。导入前会预览，不执行终端命令。', '']
    for task, ancestors in rows(tasks):
        indent = '  ' * len(ancestors)
        terminal = f' [终端](terminal-jump://open/{task["command_id"]})' if task.get('command_id') else ''
        marker = '[x]' if task.get('done') else '[ ]'
        info = metadata('ts-node', {'id': task['id'], 'kind': task.get('kind', 'task')})
        lines.append(f'{indent}- {marker} {escape_title(task["title"])}{terminal} {info}')
        for note in sorted_notes(task.get('notes', [])):
            info = {'id': note['id'], 'created': note['created']}
            if note.get('updated'):
                info['updated'] = note['updated']
            lines.append(indent + '  ' + metadata('ts-note', info))
            lines.extend(indent + '  > ' + line for line in note['text'].split('\n'))
    return '\n'.join(lines) + '\n'


def checked_text(value, label, limit, required=False):
    if not isinstance(value, str) or '\0' in value or len(value) > limit or (required and not value.strip()):
        raise ValueError(f'{label} 格式错误或过长（最多 {limit} 字符）。')
    return value


def parse(source):
    checked_text(source, 'Markdown', 240000, True)
    source = source.lstrip('\ufeff')
    canonical = HEADER in [line.strip() for line in source.splitlines()]
    if any(line.startswith('<!-- terminal-sidebar:') and line != HEADER for line in source.splitlines()):
        raise ValueError('不支持此 Markdown 格式版本。')
    entries, headings, bullets = [], [], []
    current = None
    pending_note = None
    fence = None
    identifiers = set()
    for number, line in enumerate(source.lstrip('\ufeff').splitlines(), 1):
        stripped = line.strip()
        if fence:
            closing = re.match(r'^(`{3,}|~{3,})\s*$', stripped)
            if closing and closing[1][0] == fence[0] and len(closing[1]) >= len(fence):
                fence = None
            continue
        quote = re.match(r'^\s*> ?(.*)$', line)
        if quote and current is not None:
            if pending_note is None:
                pending_note = {'text': ''}
                current['notes'].append(pending_note)
            pending_note['text'] += ('\n' if pending_note.get('_started') else '') + quote[1]
            pending_note['_started'] = True
            continue
        if pending_note is not None:
            if not pending_note.get('_started'):
                raise ValueError(f'第 {number} 行：ts-note 后必须有 > 记录正文。')
            pending_note = None
        fenced = re.match(r'^(`{3,}|~{3,})', stripped)
        if fenced:
            fence = fenced[1]
            continue
        note_match = re.fullmatch(r'<!-- ts-note: (.*?) -->', stripped)
        if note_match:
            if current is None:
                raise ValueError(f'第 {number} 行：记录没有所属节点。')
            try:
                info = json.loads(note_match[1])
                if not isinstance(info, dict) or not re.fullmatch(IDENTIFIER, info.get('id', '')):
                    raise ValueError()
                checked_text(info.get('created'), '记录时间', 80, True)
                if 'updated' in info:
                    checked_text(info['updated'], '记录更新时间', 80, True)
            except (ValueError, TypeError):
                raise ValueError(f'第 {number} 行：记录元数据格式错误。') from None
            pending_note = {'id': info['id'], 'created': info['created'], 'text': ''}
            if 'updated' in info:
                pending_note['updated'] = info['updated']
            current['notes'].append(pending_note)
            continue
        heading = re.match(r'^(#{1,6})\s+(.+?)\s*#*$', stripped)
        bullet = re.match(r'^(\s*)[-*+]\s+(?:\[([ xX])\]\s+)?(.+)$', line)
        if heading and not entries and stripped == '# Terminal Sidebar 工作清单':
            continue
        if not heading and not bullet:
            if 'ts-node:' in stripped or stripped.startswith('<!-- ts-note:'):
                raise ValueError(f'第 {number} 行：节点或记录标记格式错误。')
            continue
        if len(entries) >= 5000:
            raise ValueError('一次最多导入 5000 个节点。')
        if heading:
            level = len(heading[1])
            while headings and headings[-1][0] >= level:
                headings.pop()
            parent = headings[-1][1] if headings else None
            bullets = []
            raw_title, kind, done = heading[2], 'group', False
        else:
            level = len(bullet[1].expandtabs(4))
            while bullets and bullets[-1][0] >= level:
                bullets.pop()
            parent = bullets[-1][1] if bullets else headings[-1][1] if headings else None
            raw_title, kind, done = bullet[3], 'task', bullet[2] in ('x', 'X')
        info = {}
        node_match = re.search(r'\s*<!-- ts-node: (.*?) -->\s*$', raw_title)
        if node_match:
            try:
                info = json.loads(node_match[1])
                if not isinstance(info, dict) or not re.fullmatch(IDENTIFIER, info.get('id', '')) or info.get('kind') not in ('task', 'group'):
                    raise ValueError()
            except (ValueError, TypeError):
                raise ValueError(f'第 {number} 行：节点元数据格式错误。') from None
            if info['id'] in identifiers:
                raise ValueError(f'第 {number} 行：节点 ID 重复。')
            identifiers.add(info['id'])
            raw_title = raw_title[:node_match.start()]
        if 'ts-node:' in raw_title:
            raise ValueError(f'第 {number} 行：节点标记格式错误。')
        links = re.findall(r'(?<!!)\[[^\]]*\]\(terminal-jump://open/(' + COMMAND + r')\)', raw_title)
        if len(links) > 1:
            raise ValueError(f'第 {number} 行：每个节点只能关联一个终端。')
        separator = r'(?: · )?' if not canonical and not info else ''
        raw_title = re.sub(separator + r'\[[^\]]*\]\(terminal-jump://open/' + COMMAND + r'\)', '', raw_title).strip()
        if 'terminal-jump://' in raw_title:
            raise ValueError(f'第 {number} 行：终端链接格式无效。')
        if bullet and bullet[2] is None and not info and raw_title.startswith('**') and raw_title.endswith('**'):
            raw_title = raw_title[2:-2]
            kind = 'group'
        title = decode_title(raw_title)
        checked_text(title, '节点名称', 300, True)
        current = {'id': info.get('id'), 'title': title, 'kind': info.get('kind', kind), 'done': done, 'command_id': links[0] if links else '', 'parent': parent, 'notes': [], 'replace_notes': canonical or bool(info)}
        entries.append(current)
        (headings if heading else bullets).append((level, len(entries) - 1))
    if pending_note is not None and not pending_note.get('_started'):
        raise ValueError('末尾 ts-note 后必须有 > 记录正文。')
    if not entries and not canonical:
        raise ValueError('未找到节点；请使用 # 标题或 - [ ] 任务列表。')
    for entry in entries:
        note_ids = set()
        for note in entry['notes']:
            note.pop('_started', None)
            checked_text(note['text'], '记录', 20000)
            if note.get('id') in note_ids:
                raise ValueError('同一节点内记录 ID 重复。')
            if note.get('id'):
                note_ids.add(note['id'])
    return entries


def merge(data, source, rows, validate, timestamp):
    entries = parse(source)
    result = copy.deepcopy(data)
    known = {task['id']: task for task in result['tasks']}
    paths = {}
    for task, ancestors in rows(result['tasks']):
        paths.setdefault(tuple(ancestors + [task['title']]), []).append(task['id'])
    mapping, imported_paths, selected = {}, {}, set()
    changes = []
    counts = {'added': 0, 'updated': 0, 'unchanged': 0}
    labels = {'title': '名称', 'parent_id': '上级', 'kind': '类型', 'done': '状态', 'command_id': '终端关联', 'notes': '记录（替换）'}
    for index, entry in enumerate(entries):
        parent = entry['parent']
        path = (imported_paths[parent] if parent is not None else ()) + (entry['title'],)
        imported_paths[index] = path
        matches = paths.get(path, [])
        if not entry['id'] and len(matches) > 1:
            raise ValueError('存在同名同路径节点，请使用带 ID 的导出文件：' + ' / '.join(path))
        identifier = entry['id'] or (matches[0] if matches else uuid.uuid4().hex)
        if identifier in selected:
            raise ValueError('多个条目指向同一节点，请保留唯一 ID 或消除重复路径。')
        selected.add(identifier)
        mapping[index] = identifier
        existing = known.get(identifier)
        values = {key: entry[key] for key in ('title', 'kind', 'done', 'command_id')}
        values['parent_id'] = mapping[parent] if parent is not None else ''
        if entry['replace_notes'] or entry['notes'] or not existing:
            notes = []
            available = list(existing.get('notes', [])) if existing else []
            for note in entry['notes']:
                previous = next((old for old in available if old['id'] == note['id']), None) if note.get('id') else next((old for old in available if old['text'] == note['text']), None)
                merged_note = {'id': note.get('id') or (previous['id'] if previous else uuid.uuid4().hex), 'text': note['text'], 'created': note.get('created') or (previous['created'] if previous else timestamp)}
                if previous and previous['text'] != note['text']:
                    merged_note['updated'] = timestamp
                elif note.get('updated') or (previous and previous.get('updated')):
                    merged_note['updated'] = note.get('updated') or previous['updated']
                notes.append(merged_note)
                if previous:
                    available.remove(previous)
            values['notes'] = notes
        fields = [labels[key] for key, value in values.items() if not existing or existing.get(key) != value]
        status = 'added' if not existing else 'updated' if fields else 'unchanged'
        counts[status] += 1
        if not existing:
            existing = {'id': identifier, 'created': timestamp, 'notes': []}
            result['tasks'].append(existing)
            known[identifier] = existing
            paths.setdefault(path, []).append(identifier)
        existing.update(values)
        if fields:
            existing['updated'] = timestamp
            changes.append({'title': ' / '.join(path), 'status': status, 'fields': fields})
    validate(result)
    return result, {'revision': data['revision'], 'counts': counts, 'changes': changes, 'retained': len(data['tasks']) - len(selected.intersection(task['id'] for task in data['tasks']))}
