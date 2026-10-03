import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('mode', choices=['local', 'external'])
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
project = 'javajournal-test-' + uuid.uuid4().hex[:10]
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = str(probe.getsockname()[1])
base_url = f'http://127.0.0.1:{port}'
env = dict(os.environ)
for key in ('SECRET_KEY', 'SETUP_TOKEN', 'PG_PASSWORD', 'POSTGRES_ADMIN_PASSWORD', 'SMOKE_PASSWORD'):
    env[key] = secrets.token_hex(32)
env.update(PG_DBNAME='javajournal', PG_USER='javajournal', PG_PORT='5432', APP_PORT=port,
           APP_HOST='127.0.0.1', DATABASE_URL='', PG_SSLMODE='disable', PG_SSLROOTCERT='',
           SESSION_COOKIE_SECURE='false', APP_TRUSTED_HOSTS='localhost,127.0.0.1')
command = ['docker', 'compose', '-p', project, '-f', 'docker-compose.yml']
network, container, override = None, None, None


def run(argv, **kwargs):
    return subprocess.run(argv, cwd=root, env=env, check=True, **kwargs)


def compose(*arguments):
    return run(command + list(arguments), input=override, text=True)


try:
    if args.mode == 'local':
        command += ['-f', 'docker-compose.local.yml']
    else:
        network = project + '-database'
        container = project + '-postgres'
        run(['docker', 'network', 'create', network])
        env.update(POSTGRES_PASSWORD=env['POSTGRES_ADMIN_PASSWORD'], POSTGRES_USER='postgres',
                   POSTGRES_DB='postgres', APP_DB_NAME=env['PG_DBNAME'],
                   APP_DB_USER=env['PG_USER'], APP_DB_PASSWORD=env['PG_PASSWORD'], PG_HOST=container)
        image = project + '-postgres-image'
        run(['docker', 'build', '-f', 'postgres/Dockerfile', '-t', image, '.'])
        run(['docker', 'run', '-d', '--name', container, '--network', network,
             '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER', '-e', 'POSTGRES_DB',
             '-e', 'APP_DB_NAME', '-e', 'APP_DB_USER', '-e', 'APP_DB_PASSWORD',
             image])
        command += ['-f', '-']
        override = json.dumps({'networks': {'default': {'external': True, 'name': network}}})
    compose('up', '-d', '--build')
    architecture = run(command + ['exec', '-T', 'backend', 'python', '-c', 'import platform; print(platform.machine())'],
                       input=override, text=True, capture_output=True).stdout.strip()
    expected = {'linux/amd64': 'x86_64', 'linux/arm64': 'aarch64'}.get(env.get('DOCKER_DEFAULT_PLATFORM'))
    if expected:
        assert architecture == expected, f'Expected {expected}, received {architecture}'
    print(f'Testing {args.mode} on {architecture}.')
    run([sys.executable, 'scripts/smoke-test.py', '--base-url', base_url, '--confirm-test-instance'])
    compose('run', '--rm', 'initialize')
    compose('restart', 'backend')
    run([sys.executable, 'scripts/smoke-test.py', '--base-url', base_url, '--confirm-test-instance'])
    print(f'{args.mode} Compose checks passed, including reinitialization and restart persistence.')
finally:
    try:
        compose('logs', '--tail', '30')
        compose('down')
    finally:
        if container:
            subprocess.run(['docker', 'stop', container], cwd=root, check=False)
            subprocess.run(['docker', 'rm', container], cwd=root, check=False)
        if network:
            subprocess.run(['docker', 'network', 'rm', network], cwd=root, check=False)
