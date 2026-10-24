import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/tradePositionDates.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { getPositionExecutionDates } = module.exports;

const execution = (symbol, trade_date, is_open) => ({
  id: 1,
  account_id: 1,
  symbol,
  side: 'BUY',
  quantity: 1,
  price: 10,
  trade_date,
  is_open,
});

test('position dates use the earliest opening and latest closing execution dates', () => {
  const dates = getPositionExecutionDates([
    execution('MNQ', '2026-10-22', true),
    execution('MNQ', '2026-10-20', true),
    execution('MNQ', '2026-10-23', false),
    execution('MNQ', '2026-10-21', false),
  ]);
  assert.deepEqual({ ...dates.get('MNQ') }, { openDate: '2026-10-20', closeDate: '2026-10-23' });
});

test('open positions without closing executions have no close date', () => {
  const dates = getPositionExecutionDates([execution('ES', '2026-10-20', null)]);
  assert.deepEqual({ ...dates.get('ES') }, { openDate: '2026-10-20', closeDate: null });
});

test('trade position cards replace security descriptions with date-only columns', () => {
  const source = readFileSync(new URL('../src/components/TradeDetailPage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Security Description/);
  assert.equal((source.match(/<TableHead>Open Date<\/TableHead>/g) ?? []).length, 2);
  assert.equal((source.match(/<TableHead>Close Date<\/TableHead>/g) ?? []).length, 2);
  assert.doesNotMatch(source, /formatDateTimeUtil\(pos\.(?:openDate|closeDate)\)/);
});
