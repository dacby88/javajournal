import argparse
from http.cookiejar import CookieJar
import json
import os
import secrets
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:7080')
parser.add_argument('--confirm-test-instance', action='store_true', required=True)
args = parser.parse_args()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def request(path, method='GET', payload=None, headers=None, expected=200, timeout=30):
    body = None if payload is None else json.dumps(payload).encode()
    options = {'Content-Type': 'application/json', **(headers or {})}
    if method != 'GET':
        options['X-CSRF-Token'] = request('/api/auth/csrf')['csrf_token']
    req = urllib.request.Request(args.base_url + path, data=body, headers=options, method=method)
    try:
        result = client.open(req, timeout=timeout)
    except urllib.error.HTTPError as error:
        result = error
    assert result.status == expected, f'{method} {path}: expected {expected}, received {result.status}'
    return json.load(result)


deadline = time.monotonic() + 180
while True:
    try:
        assert request('/api/ready', timeout=5)['status'] == 'ready'
        break
    except (urllib.error.URLError, AssertionError, OSError):
        if time.monotonic() >= deadline:
            raise
        time.sleep(2)
request('/api/accounts', expected=401)
password = os.environ.get('SMOKE_PASSWORD') or secrets.token_urlsafe(32)
username = 'synthetic_smoke_owner'
if request('/api/auth/status')['needs_setup']:
    payload = {'username': username, 'password': password}
    request('/api/auth/setup', 'POST', payload, expected=403)
    request('/api/auth/setup', 'POST', payload, {'X-Setup-Token': os.environ['SETUP_TOKEN']}, expected=201)
    formats = request('/api/broker-formats')['data']
    ibkr = next(item['id'] for item in formats if item['code'] == 'ibkr')
    account = request('/api/accounts', 'POST', {'name': 'Synthetic smoke account', 'broker_format_id': ibkr})['data']
    csrf = request('/api/auth/csrf')['csrf_token']
    boundary = 'javajournal-synthetic-boundary'
    csv = 'Symbol,AssetClass,Buy/Sell,Quantity,Price,TradeDate,Date/Time,Commission,NetCash,ExecID\nAAPL,STK,BUY,1,100,20260115,20260115;093000,0,-100,SYNTHETIC-1\nAAPL,STK,SELL,1,110,20260115,20260115;100000,0,110,SYNTHETIC-2\n'
    parts = []
    for name, value in (('account_id', account['id']), ('broker_format_id', ibkr)):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n')
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.csv"\r\nContent-Type: text/csv\r\n\r\n{csv}\r\n--{boundary}--\r\n')
    req = urllib.request.Request(args.base_url + '/api/import/csv', data=''.join(parts).encode(), headers={
        'Content-Type': f'multipart/form-data; boundary={boundary}', 'X-CSRF-Token': csrf,
    })
    with client.open(req, timeout=60) as response:
        assert json.load(response)['success']
else:
    request('/api/auth/login', 'POST', {'username': username, 'password': password})

stats = request('/api/dashboard')['data']['overall']
assert stats['total_trades'] == 1 and stats['net_pnl'] == 10
request('/api/auth/logout', 'POST')
request('/api/accounts', expected=401)
request('/api/auth/login', 'POST', {'username': username, 'password': password})
assert len(request('/api/accounts')['data']) == 1
print('Smoke checks passed: setup, authentication, CSRF, synthetic import and dashboard.')
