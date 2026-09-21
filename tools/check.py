#!/usr/bin/env python3
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'terminal-workspace-release'
sys.path.insert(0, str(ASSETS))
import build_guide
import build_release
from versioning import validate_version


def tracked_sources():
    expected = {'.gitignore', 'README.md', 'Install.command', '.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/pages.yml', 'tools/check.py', 'tools/set_version.py'}
    expected.update(component + '/' + filename for component, files in build_release.COMPONENTS.items() for filename in files)
    expected.update('terminal-workspace-release/' + filename for filename in build_release.ASSETS)
    expected.update('terminal-workspace-release/' + filename for filename in ['SITE.md', 'GUIDE_VERSION', 'build_guide.py'])
    expected.update('terminal-workspace-release/site/' + filename for filename in build_guide.SITE_FILES + ['demo-actor.js', 'demo-backend.js'])
    tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')) - {''}
    if tracked != expected:
        raise ValueError('仓库白名单不匹配：多出 ' + repr(sorted(tracked - expected)) + '；缺少 ' + repr(sorted(expected - tracked)))
    private_path = re.compile(r'/(?:' + 'Users' + r'|home)/[^\s/]+/')
    for filename in sorted(tracked):
        path = ROOT / filename
        if path.is_symlink() or not path.is_file():
            raise ValueError('拒绝非普通源码文件：' + filename)
        text = path.read_text(encoding='utf-8')
        if private_path.search(text) or re.search(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}', text):
            raise ValueError('疑似个人路径或凭据：' + filename)
        if path.suffix == '.py':
            ast.parse(text, filename=filename)
        if path.suffix == '.js':
            subprocess.run(['node', '--check', str(path)], check=True, stdout=subprocess.DEVNULL)
    return len(tracked)


def verify_archive(archive):
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if archive.with_suffix('.zip.sha256').read_text().split()[0] != digest:
        raise ValueError('ZIP 校验失败：' + archive.name)
    with zipfile.ZipFile(archive) as bundle:
        names = bundle.namelist()
        root = archive.stem + '/'
        if len(names) != len(set(names)) or any(not name.startswith(root) or '..' in Path(name).parts for name in names):
            raise ValueError('ZIP 路径或重复条目异常')
        manifest = json.loads(bundle.read(root + 'MANIFEST.json'))
        expected = {root + 'MANIFEST.json'} | {root + entry['path'] for entry in manifest['files']}
        if set(names) != expected:
            raise ValueError('ZIP 与清单文件不一致')
        for entry in manifest['files']:
            content = bundle.read(root + entry['path'])
            if len(content) != entry['bytes'] or hashlib.sha256(content).hexdigest() != entry['sha256']:
                raise ValueError('文件校验失败：' + entry['path'])
            if content != (archive.parent / archive.stem / entry['path']).read_bytes():
                raise ValueError('ZIP 与构建目录不一致')
        if manifest.get('kind') == 'macOS-source':
            if (bundle.getinfo(root + 'Install.command').external_attr >> 16) & 0o111 == 0:
                raise ValueError('安装入口缺少可执行权限')
        else:
            for filename in ['index.html', 'style.css', 'app.js']:
                if bundle.read(root + 'product-source/' + filename) != (ROOT / 'terminal-sidebar/static' / filename).read_bytes():
                    raise ValueError('演示前端与应用源码不一致')


def main():
    parser = argparse.ArgumentParser(description='检查仓库白名单、源码语法、版本与发行包；不安装或执行应用。')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--tag', help='Tag 发布时必须与 VERSION 精确匹配')
    arguments = parser.parse_args()
    if not shutil.which('node'):
        raise RuntimeError('源码检查需要 Node.js；安装和离线阅读不需要 Node.js。')
    count = tracked_sources()
    version = validate_version((ASSETS / 'VERSION').read_text().strip())
    guide = validate_version((ASSETS / 'GUIDE_VERSION').read_text().strip())
    if ('-' in version) != ('-' in guide):
        raise ValueError('应用和网站发布渠道不一致')
    if arguments.tag and arguments.tag != 'v' + version:
        raise ValueError('Tag 与 VERSION 不一致，拒绝发布')
    if "'CFBundleShortVersionString': '" + version.split('-', 1)[0] + "'" not in (ROOT / 'terminal-sidebar/install.py').read_text():
        raise ValueError('App bundle 版本未同步，请运行 tools/set_version.py')
    if 'ui=release-' + version + "'" not in (ROOT / 'terminal-sidebar/register_tool.py').read_text():
        raise ValueError('侧栏版本未同步，请运行 tools/set_version.py')
    output = arguments.output.absolute()
    if output.exists() and any(output.iterdir()):
        raise ValueError('输出目录非空，拒绝覆盖；请使用新目录')
    for builder in ['build_release.py', 'build_guide.py']:
        subprocess.run([sys.executable, str(ASSETS / builder), '--output', str(output)], check=True)
    for archive in output.glob('*.zip'):
        verify_archive(archive)
    channel = '开发预发布（不替代稳定版，安装前备份）' if '-' in version else '稳定版'
    notes = f'''# TerminalWorkBar {version}

渠道：{channel}。配套离线网站：{guide}。

- 应用：`Terminal-Workspace-{version}-macOS-source.zip`，解压后双击 `Install.command`。
- 网站：`Terminal-Workspace-Guide-{guide}.zip`，解压后打开 `index.html`。
- 下载对应 `.zip.sha256`，用 `shasum -a 256 -c 文件名.zip.sha256` 校验。
- 需要 macOS 14+、Python 3.11+、iTerm2 和 Apple Command Line Tools；首次安装下载固定 SDK 依赖。
- 本包是源码安装包，不是已签名公证的二进制 App。开发 / 稳定版共用本机数据，升级前备份。
- 不包含个人任务、SSH 配置、密钥或运行令牌；不自动导入示例或开启连接。

准确源码对应 Tag `v{version}`。安装、操作、升级与交接文档均在包内。

## 变更记录

'''
    (output / 'RELEASE_NOTES.md').write_text(notes + (ASSETS / 'CHANGELOG.md').read_text(), encoding='utf-8')
    print(f'PASS: {count} 个白名单源码文件；版本 {version} / {guide}；两个 ZIP 及清单校验通过。')


if __name__ == '__main__':
    main()
