import re


VERSION_PATTERN = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(dev|alpha|beta|rc)\.([1-9][0-9]*))?')


def validate_version(value):
    if not VERSION_PATTERN.fullmatch(value):
        raise ValueError('版本必须为 X.Y.Z 或 X.Y.Z-dev.N / alpha.N / beta.N / rc.N，N 从 1 开始。')
    return value
