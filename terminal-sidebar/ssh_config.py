import glob
import itertools
from pathlib import Path
import re
import shlex
import stat


def list_hosts(home=None):
    home = Path(home) if home is not None else Path.home()
    base = home / '.ssh'
    source = base / 'config'
    aliases = {}
    visited = set()
    warnings = set()
    total_bytes = 0

    def visit(filename, depth):
        nonlocal total_bytes
        if total_bytes >= 1048576:
            warnings.add('SSH 配置超过读取大小上限，部分配置未读取。')
            return
        if depth > 12 or len(visited) >= 128:
            warnings.add('Include 层数或文件数量超过安全上限，部分配置未读取。')
            return
        try:
            resolved = filename.resolve()
            if resolved in visited:
                return
            visited.add(resolved)
            if not stat.S_ISREG(resolved.stat().st_mode):
                warnings.add('跳过非普通配置文件。')
                return
            limit = min(262144, 1048576 - total_bytes)
            with resolved.open('rb') as stream:
                content = stream.read(limit + 1)
            total_bytes += len(content)
            if len(content) > limit:
                warnings.add('SSH 配置超过读取大小上限，部分配置未读取。')
                return
            lines = content.decode('utf-8-sig').splitlines()
        except (OSError, RuntimeError, UnicodeError):
            warnings.add('部分 SSH 配置无法读取，候选列表可能不完整。')
            return
        conditional = False
        for line in lines:
            match = re.match(r'^\s*([A-Za-z]+)\s*(?:=\s*)?(.*)$', line)
            if not match:
                continue
            keyword = match[1].lower()
            if keyword not in ('host', 'include', 'match'):
                continue
            if keyword == 'match':
                conditional = True
                continue
            try:
                values = shlex.split(match[2], comments=True, posix=True)
            except ValueError:
                warnings.add('部分 Host / Include 行语法无法解析，已跳过。')
                continue
            if keyword == 'host':
                conditional = False
                for value in values:
                    if re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@-]{0,199}', value):
                        aliases.setdefault(value.casefold(), value)
                continue
            if conditional:
                warnings.add('Match 条件中的 Include 未展开；不会执行 Match exec。')
                continue
            for value in values:
                value = value.replace('%d', str(home))
                if '%' in value or '${' in value or value.startswith('~') and not value.startswith('~/'):
                    warnings.add('包含动态变量的 Include 未展开，可手动输入主机。')
                    continue
                pattern = str(home / value[2:]) if value.startswith('~/') else str(base / value) if not Path(value).is_absolute() else value
                matches = sorted(itertools.islice(glob.iglob(pattern), 129))
                if not matches:
                    warnings.add('部分 Include 没有匹配到文件。')
                if len(matches) > 128:
                    warnings.add('Include 匹配文件过多，只读取受限数量。')
                for included in matches[:128]:
                    visit(Path(included), depth + 1)

    if source.exists():
        visit(source, 0)
    hosts = sorted(aliases.values(), key=str.casefold)
    message = f'从本机 SSH 配置发现 {len(hosts)} 个候选别名；选择不会连接服务器。' if hosts else '未发现可选别名，可手动输入 SSH 主机或 user@host。'
    return {'hosts': hosts, 'warnings': sorted(warnings), 'message': message}
