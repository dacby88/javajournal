import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/filterQuery.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, URLSearchParams });
const { filtersToSearchParams, mergeFiltersFromSearchParams } = module.exports;

test('applied trade filters survive a URL round trip', () => {
  const filters = {
    symbol: 'SPX',
    side: 'SHORT',
    account_ids: [2, 7],
    tag_ids: [3, 4],
    tag_mode: 'ANY',
    start_date: '2026-10-01',
    end_date: '2026-10-24',
    trade_status: 'closed',
    limit: 50,
    offset: 100,
    sort_by: 'entry_date',
    sort_order: 'desc',
  };
  const restored = mergeFiltersFromSearchParams({ limit: 50, offset: 0 }, filtersToSearchParams(filters));
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), filters);
});

test('execution matched filters restore to API booleans and form strings', () => {
  const params = filtersToSearchParams({ matched: false, account_ids: [2], asset_class: 'OPT' });
  const applied = mergeFiltersFromSearchParams({ limit: 50, offset: 0 }, params);
  const form = mergeFiltersFromSearchParams({ matched: 'ALL', account_ids: [] }, params);
  assert.equal(applied.matched, false);
  assert.equal(form.matched, 'false');
  assert.deepEqual([...applied.account_ids], [2]);
  assert.equal(applied.asset_class, 'OPT');
});

test('empty optional filters do not overwrite saved values', () => {
  const params = filtersToSearchParams({ symbol: undefined, account_ids: [], limit: 50, offset: 0 });
  const restored = mergeFiltersFromSearchParams({ symbol: 'SPX', account_ids: [2] }, params);
  assert.equal(restored.symbol, 'SPX');
  assert.deepEqual([...restored.account_ids], [2]);
});

test('trade and execution pages synchronize applied filters with their URLs', () => {
  for (const page of ['TradesPage.tsx', 'ExecutionsPage.tsx']) {
    const source = readFileSync(new URL(`../src/components/${page}`, import.meta.url), 'utf8');
    assert.match(source, /filtersToSearchParams\(filters\)/);
    assert.match(source, /mergeFiltersFromSearchParams/);
    assert.match(source, /setSearchParams\(params, \{ replace: true \}\)/);
  }
});
