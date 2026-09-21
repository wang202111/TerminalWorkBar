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
SITE_FILES = ['index.html', 'demo.css', 'demo-shell.js', 'film.html', 'cinema.css', 'cinema.js', 'manual.html', 'styles.css', 'app.js']
REFERENCES = ['INSTALL.md', 'HANDOFF.md', 'TESTING.md', 'CHANGELOG.md', 'RELEASING.md']
EXAMPLES = ['README.md', 'tasks.example.json', 'commands.example.json', 'ssh-config.example']


def copy_file(source, base, destination):
    if source.is_symlink() or not source.resolve().is_relative_to(base.resolve()) or not source.is_file():
        raise ValueError('拒绝复制越界或非普通文件：' + str(source))
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def task_rows(tasks):
    children = {}
    for task in tasks:
        children.setdefault(task['parent_id'], []).append(task)
    pending = [(task, []) for task in reversed(children.get('', []))]
    while pending:
        task, ancestors = pending.pop()
        yield task, ancestors
        pending.extend((child, ancestors + [task['title']]) for child in reversed(children.get(task['id'], [])))


def main():
    parser = argparse.ArgumentParser(description='从白名单源码构建离线使用说明网站，不读取用户配置。')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--guide-version', default=(ROOT / 'GUIDE_VERSION').read_text().strip())
    arguments = parser.parse_args()
    version = validate_version((ROOT / 'VERSION').read_text().strip())
    guide_version = validate_version(arguments.guide_version)
    name = 'Terminal-Workspace-Guide-' + guide_version
    output = arguments.output.absolute()
    output.mkdir(parents=True, exist_ok=True)
    folder = output / name
    archive = output / (name + '.zip')
    checksum = output / (name + '.zip.sha256')
    if any(path.exists() for path in (folder, archive, checksum)):
        raise ValueError('同名网站产物已存在，拒绝覆盖；请选择新的输出目录。')
    with tempfile.TemporaryDirectory(prefix='.guide-', dir=output) as temporary:
        staging = Path(temporary) / name
        staging.mkdir()
        for filename in SITE_FILES:
            copy_file(ROOT / 'site' / filename, ROOT / 'site', staging / filename)
        product = ROOT.parent / 'terminal-sidebar/static'
        for filename in ['index.html', 'style.css', 'app.js']:
            copy_file(product / filename, product, staging / 'product-source' / filename)
        for filename in ['demo-backend.js', 'demo-actor.js']:
            copy_file(ROOT / 'site' / filename, ROOT / 'site', staging / filename)
        product_html = (product / 'index.html').read_text()
        product_html = product_html.replace('<link rel="stylesheet" href="style.css">', '<style>' + (product / 'style.css').read_text() + '</style>')
        product_html = product_html.replace('<script src="app.js" defer></script>', '')
        policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">'
        product_html = product_html.replace('<head>', '<head>' + policy, 1)
        scripts = [(ROOT / 'site/demo-backend.js').read_text(), (product / 'app.js').read_text(), (ROOT / 'site/demo-actor.js').read_text()]
        for script in scripts:
            if '</script' in script.lower():
                raise ValueError('产品脚本包含不安全的内联结束标签')
        product_html = product_html.replace('</body>', ''.join('<script>' + script + '</script>' for script in scripts) + '</body>')
        (staging / 'demo-content.js').write_text('window.PRODUCT_DEMO_HTML = ' + json.dumps(product_html, ensure_ascii=True) + ';\n', encoding='utf-8')
        for filename in REFERENCES:
            copy_file(ROOT / filename, ROOT, staging / 'reference' / filename)
        for filename in EXAMPLES:
            copy_file(ROOT / 'examples' / filename, ROOT / 'examples', staging / 'examples' / filename)
        copy_file(ROOT / 'SITE.md', ROOT, staging / 'README.md')
        module_path = ROOT.parent / 'terminal-sidebar/markdown_io.py'
        specification = importlib.util.spec_from_file_location('guide_markdown', module_path)
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        tasks = json.loads((staging / 'examples/tasks.example.json').read_text())['tasks']
        examples = {}
        for style, filename in [('pretty', 'tasks.md'), ('roundtrip', 'tasks.roundtrip.md')]:
            content = module.serialize(tasks, task_rows, style)
            (staging / 'examples' / filename).write_text(content, encoding='utf-8')
            examples[style] = content
        encoded = json.dumps(examples, ensure_ascii=True).replace('<', '\\u003c')
        (staging / 'guide-data.js').write_text('window.GUIDE_EXAMPLES = ' + encoded + ';\n', encoding='utf-8')
        files = sorted(path for path in staging.rglob('*') if path.is_file())
        entries = [{'path': path.relative_to(staging).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size} for path in files]
        manifest = {'version': guide_version, 'application_version': version, 'kind': 'offline-guide', 'files': entries, 'note': '仅静态文档与虚构示例；本清单不包含自身，ZIP 校验覆盖全部。'}
        (staging / 'MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        files.append(staging / 'MANIFEST.json')
        temporary_archive = Path(temporary) / archive.name
        with zipfile.ZipFile(temporary_archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
            for path in sorted(files):
                path.chmod(0o644)
                member = zipfile.ZipInfo(name + '/' + path.relative_to(staging).as_posix(), date_time=(2026, 9, 20, 0, 0, 0))
                member.create_system = 3
                member.external_attr = 0o100644 << 16
                member.compress_type = zipfile.ZIP_DEFLATED
                bundle.writestr(member, path.read_bytes())
        staging.rename(folder)
        temporary_archive.rename(archive)
    checksum.write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n', encoding='utf-8')
    print('Website: ' + str(folder / 'index.html'))
    print('Archive: ' + str(archive))


if __name__ == '__main__':
    main()
