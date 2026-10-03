import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/http.ts', import.meta.url), 'utf8').replace('export async function', 'async function');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(fetch) {
  const redirects = [];
  const context = vm.createContext({ fetch, Headers, window: { location: { pathname: '/', assign: path => redirects.push(path) } } });
  vm.runInContext(compiled, context);
  return { request: context.apiFetch, redirects };
}

const csrf = { ok: true, json: async () => ({ csrf_token: 'synthetic-csrf-token' }) };

test('mutations attach CSRF and preserve setup headers and upload bodies', async () => {
  const calls = [];
  const h = harness(async (url, options) => {
    calls.push({ url, options });
    return url === '/api/auth/csrf' ? csrf : { ok: true, status: 200 };
  });
  const upload = new FormData();
  await h.request('/api/import/csv', { method: 'POST', body: upload, headers: { 'X-Setup-Token': 'synthetic-setup-token' } });
  assert.equal(calls[1].options.credentials, 'include');
  assert.equal(calls[1].options.headers.get('X-CSRF-Token'), 'synthetic-csrf-token');
  assert.equal(calls[1].options.headers.get('X-Setup-Token'), 'synthetic-setup-token');
  assert.equal(calls[1].options.body, upload);
  assert.equal(calls[1].options.headers.has('Content-Type'), false);
});

test('GET requests do not fetch CSRF tokens', async () => {
  const calls = [];
  const h = harness(async url => { calls.push(url); return { status: 200 }; });
  await h.request('/api/accounts');
  assert.deepEqual(calls, ['/api/accounts']);
});

test('concurrent mutations share the pending token request', async () => {
  let count = 0;
  const h = harness(async url => { if (url === '/api/auth/csrf') { count++; return csrf; } return { status: 200 }; });
  await Promise.all([h.request('/api/accounts', { method: 'POST' }), h.request('/api/tags', { method: 'POST' })]);
  assert.equal(count, 1);
});

test('failed token requests do not send the mutation', async () => {
  const calls = [];
  const h = harness(async url => { calls.push(url); return { ok: false }; });
  await assert.rejects(h.request('/api/accounts', { method: 'POST' }), /secure session/);
  assert.deepEqual(calls, ['/api/auth/csrf']);
});

test('unauthorized API requests redirect, but failed logins do not', async () => {
  const h = harness(async url => url === '/api/auth/csrf' ? csrf : { status: 401 });
  await h.request('/api/accounts');
  await h.request('/api/auth/login', { method: 'POST' });
  assert.deepEqual(h.redirects, ['/login']);
});
