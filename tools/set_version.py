#!/usr/bin/env python3
import argparse
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'terminal-workspace-release'
sys.path.insert(0, str(ASSETS))
from versioning import validate_version


def main():
    parser = argparse.ArgumentParser(description='同步发行版本与侧栏标记，不修改用户安装或数据。')
    parser.add_argument('version')
    parser.add_argument('--guide', required=True, help='同次发布的网站版本；网站嵌入了应用前端，也必须升级')
    arguments = parser.parse_args()
    version = validate_version(arguments.version)
    guide = validate_version(arguments.guide)
    if ('-' in version) != ('-' in guide):
        raise ValueError('应用与网站必须同为稳定版或同为预发布。')
    base = version.split('-', 1)[0]
    changes = {ASSETS / 'VERSION': version + '\n', ASSETS / 'GUIDE_VERSION': guide + '\n'}
    for filename, pattern, replacement in [
        ('install.py', r"('CFBundleShortVersionString': ')[^']+", r'\g<1>' + base),
        ('register_tool.py', r'ui=release-[0-9A-Za-z.-]+', 'ui=release-' + version),
    ]:
        path = ROOT / 'terminal-sidebar' / filename
        content, count = re.subn(pattern, replacement, path.read_text())
        if count != 1:
            raise ValueError('无法唯一定位版本字段：' + filename)
        changes[path] = content
    for path, content in changes.items():
        path.write_text(content, encoding='utf-8')
    print('App ' + version + ' / Guide ' + guide + '；请更新 CHANGELOG 后校验、提交并打 Tag。')


if __name__ == '__main__':
    main()
