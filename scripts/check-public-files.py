from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root).decode().split('\0')
allowed_roots = {'backend', 'frontend', 'postgres', 'scripts', 'examples', '.github'}
allowed_files = {'README.md', 'LICENSE', 'AGENTS.md', 'pytest.ini', '.gitignore', '.dockerignore',
                 'docker-compose.yml', 'docker-compose.local.yml', '.env.local.example', '.env.external.example'}
patterns = [r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
            r'\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}',
            r'\bAKIA[A-Z0-9]{16}\b', r'/Users/[A-Za-z0-9_-]+/',
            r'\b192\.168\.\d{1,3}\.\d{1,3}\b']
problems = []
for name in sorted(set(paths) - {''}):
    path = Path(name)
    if (len(path.parts) == 1 and name not in allowed_files) or (len(path.parts) > 1 and path.parts[0] not in allowed_roots):
        problems.append((name, 'unexpected publication path'))
    if path.suffix in {'.db', '.sqlite', '.sqlite3', '.dump', '.key', '.pem'} or name.startswith('frontend/dist/'):
        problems.append((name, 'private data or generated artifact'))
    if path.suffix == '.csv' and not name.startswith('examples/synthetic-'):
        problems.append((name, 'CSV must be an explicitly synthetic example'))
    data = (root / name).read_bytes()
    if b'\0' in data:
        continue
    content = data.decode('utf-8', errors='replace')
    if any(re.search(pattern, content) for pattern in patterns):
        problems.append((name, 'potential sensitive content; manual review required'))
if problems:
    for name, reason in problems:
        print(f'{name}: {reason}', file=sys.stderr)
    sys.exit(1)
print(f'Publication checks passed for {len(set(paths) - {""})} files. Manual review is still required.')
