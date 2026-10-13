import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/dashboardPnl.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { chartTradePnl, untaggedTagBucket } = module.exports;

test('open trades use the live mark and a missing quote contributes nothing', () => {
  assert.equal(chartTradePnl({ is_open: true, open_pnl: 40, net_pnl: 0 }), 40);
  assert.equal(chartTradePnl({ is_open: true, open_pnl: null, net_pnl: 0 }), null);
  assert.equal(chartTradePnl({ is_open: false, net_pnl: -12 }), -12);
  assert.equal(chartTradePnl({ is_open: false, open_pnl: 99, net_pnl: 5 }), 5);
});

test('the untagged bucket skips tagged trades and unmarked open trades', () => {
  const bucket = untaggedTagBucket([
    { is_open: false, net_pnl: 10, tags: [] },
    { is_open: true, open_pnl: -3, net_pnl: 0, tags: [] },
    { is_open: true, open_pnl: null, net_pnl: 0, tags: [] },
    { is_open: true, open_pnl: 100, net_pnl: 0, tags: [{ id: 1 }] },
  ]);
  assert.equal(bucket.length, 1);
  assert.equal(bucket[0].tag, '(untagged)');
  assert.equal(bucket[0].pnl, 7);
  assert.equal(bucket[0].count, 2);
  assert.equal(bucket[0].color, '#22c55e');
  assert.equal(untaggedTagBucket([
    { is_open: true, open_pnl: null, net_pnl: 0, tags: [] },
  ]).length, 0);
});
