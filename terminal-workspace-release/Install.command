#!/usr/bin/env bash
set -u
cd "$(dirname "$0")" || exit 1
interpreter=""
for candidate in "${PYTHON:-}" /opt/homebrew/bin/python3 /usr/local/bin/python3 python3; do
    [ -n "$candidate" ] || continue
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 11))' >/dev/null 2>&1; then
        interpreter="$candidate"
        break
    fi
done
if [ -z "$interpreter" ]; then
    printf '\n需要 Python 3.11 或更新版本。请按 INSTALL.md 安装 Python 后重试。\n'
    status=1
else
    "$interpreter" install.py "$@"
    status=$?
fi
if [ -t 0 ]; then
    printf '\n按回车关闭此窗口。'
    read -r answer
fi
exit "$status"
