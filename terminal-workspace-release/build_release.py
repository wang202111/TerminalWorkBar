#!/usr/bin/env python3
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import zipfile
from versioning import validate_version


ROOT = Path(__file__).resolve().parent
COMPONENTS = {
    'terminal-jump': ['TerminalJump.swift', 'config_manager.py', 'terminal_jump.py', 'install.py'],
    'terminal-sidebar': ['sidebar.py', 'markdown_io.py', 'ssh_config.py', 'register_tool.py', 'install.py', 'static/index.html', 'static/app.js', 'static/style.css'],
}
ASSETS = ['README.md', 'INSTALL.md', 'HANDOFF.md', 'TESTING.md', 'CHANGELOG.md', 'RELEASING.md', 'VERSION', 'Install.command', 'install.py', 'build_release.py', 'versioning.py', 'examples/README.md', 'examples/tasks.example.json', 'examples/commands.example.json', 'examples/ssh-config.example']


def rows(tasks):
    children = {}
    for task in tasks:
        children.setdefault(task['parent_id'], []).append(task)
    pending = [(task, []) for task in reversed(children.get('', []))]
    while pending:
        task, ancestors = pending.pop()
        yield task, ancestors
        pending.extend((child, ancestors + [task['title']]) for child in reversed(children.get(task['id'], [])))


def copy_allowed(source, base, destination):
    if source.is_symlink() or not source.resolve().is_relative_to(base.resolve()) or not source.is_file():
        raise ValueError('拒绝打包非普通或越界来源：' + str(source))
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    destination.chmod(0o755 if destination.name == 'Install.command' else 0o644)


def main():
    parser = argparse.ArgumentParser(description='白名单构建无用户数据的源码发行包。')
    parser.add_argument('--source-root', type=Path, default=ROOT.parent)
    parser.add_argument('--assets', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    version = validate_version((arguments.assets / 'VERSION').read_text().strip())
    name = 'Terminal-Workspace-' + version + '-macOS-source'
    output = arguments.output.absolute()
    output.mkdir(parents=True, exist_ok=True)
    folder = output / name
    archive = output / (name + '.zip')
    checksum = archive.with_suffix('.zip.sha256')
    if any(path.exists() for path in (folder, archive, checksum)):
        raise ValueError('同名发行文件已存在，拒绝覆盖；请选择新的输出目录。')
    with tempfile.TemporaryDirectory(prefix='.release-', dir=output) as temporary:
        staging = Path(temporary) / name
        staging.mkdir()
        for component, files in COMPONENTS.items():
            for filename in files:
                copy_allowed(arguments.source_root / component / filename, arguments.source_root, staging / component / filename)
        for filename in ASSETS:
            copy_allowed(arguments.assets / filename, arguments.assets, staging / filename)
        specification = importlib.util.spec_from_file_location('release_markdown', staging / 'terminal-sidebar/markdown_io.py')
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        tasks = json.loads((staging / 'examples/tasks.example.json').read_text())['tasks']
        for filename, style in [('tasks.md', 'pretty'), ('tasks.roundtrip.md', 'roundtrip')]:
            (staging / 'examples' / filename).write_text(module.serialize(tasks, rows, style), encoding='utf-8')
        files = []
        for path in sorted(staging.rglob('*')):
            if path.is_file() and '__pycache__' not in path.parts:
                content = path.read_bytes()
                files.append({'path': path.relative_to(staging).as_posix(), 'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)})
        manifest = {'release': version, 'kind': 'macOS-source', 'files': files, 'note': '清单不包含自身；整包校验覆盖全部文件。仅白名单源码、文档与合成示例，无用户运行数据。'}
        (staging / 'MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        for cache in staging.rglob('__pycache__'):
            shutil.rmtree(cache)
        for relative in [entry['path'] for entry in files] + ['MANIFEST.json']:
            (staging / relative).chmod(0o755 if relative == 'Install.command' else 0o644)
        temporary_archive = Path(temporary) / archive.name
        with zipfile.ZipFile(temporary_archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
            for relative in sorted([entry['path'] for entry in files] + ['MANIFEST.json']):
                member = zipfile.ZipInfo(name + '/' + relative, date_time=(2026, 9, 20, 0, 0, 0))
                member.create_system = 3
                member.external_attr = (0o100755 if relative == 'Install.command' else 0o100644) << 16
                member.compress_type = zipfile.ZIP_DEFLATED
                bundle.writestr(member, (staging / relative).read_bytes())
        staging.rename(folder)
        temporary_archive.rename(archive)
    checksum.write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n', encoding='utf-8')
    print('Release: ' + str(archive))
    print('Directory: ' + str(folder))
    print('SHA-256: ' + str(checksum))


if __name__ == '__main__':
    main()
