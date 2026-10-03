import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'App');
const declaration = app.body.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
  .find(node => node.name.getText(file) === 'sortinoStats');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
const helper = new URL('../src/lib/sortino.ts', import.meta.url);
if (existsSync(helper)) vm.runInNewContext(compile(readFileSync(helper, 'utf8')), { module, exports: module.exports });
const dailyRate = annual => Math.expm1(Math.log1p(annual / 100) / 252);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const account = (id, target, balance, mode = 'percent') => ({ id, name: `Synthetic ${id}`, settings: { sortino_target_mode: mode, sortino_target: target, starting_account_value: balance } });
const trade = (id, accountId, date, pnl, tags = []) => ({ id, account_id: accountId, entry_date: '2026-01-01', exit_date: date, net_pnl: pnl, is_open: false, tags });
const ledger = (opening = [], daily = [], start = '2026-01-01', end = '2026-01-31') => ({ start_date: start, end_date: end, opening_pnl: opening, daily_pnl: daily });

function calculate({ accounts = [], trades = [], selected = [1], equity = ledger(), tags = [], includeUntagged = true, fallback = 99 } = {}) {
  const context = vm.createContext({ Math, Date, Map, Set, Number, Array, console: { log() {} },
    accounts, allTrades: trades, selectedAccounts: selected,
    cardTagSettings: { selectedTagIds: tags, includeUntagged, intradayOnly: false },
    stats: { sortino_ratio: fallback }, data: { sortino_equity: equity },
    calculateSortinoStats: module.exports.calculateSortinoStats,
  });
  return vm.runInContext(compile(`(${declaration.initializer.arguments[0].getText(file)})()`), context);
}


test('annual percent is converted to a daily compounded target on opening equity', () => {
  const result = calculate({ accounts: [account(1, 10, 100000)],
    trades: [trade(1, 1, '2026-01-05', -500)],
    equity: ledger([{ account_id: 1, net_pnl: 10000 }]),
  });
  near(result.dailyTarget, 110000 * dailyRate(10));
  near(result.avgDailyReturn, -500);
  near(result.downsideRisk, 500 + 110000 * dailyRate(10));
});

test('all realized P&L changes subsequent equity even when card tags exclude it', () => {
  const trades = [trade(1, 1, '2026-01-02', 10000, [{ id: 2 }]),
    trade(2, 1, '2026-01-05', -1000, [{ id: 1 }]), trade(3, 1, '2026-01-06', 2000, [{ id: 1 }])];
  const result = calculate({ accounts: [account(1, 10, 100000)], trades, tags: [1], includeUntagged: false,
    equity: ledger([], trades.map(t => ({ account_id: t.account_id, date: t.exit_date, net_pnl: t.net_pnl }))),
  });
  near(result.dailyTarget, (110000 + 109000) / 2 * dailyRate(10));
  assert.equal(result.daysTraded, 2);
  near(result.avgDailyReturn, 500);
  near(result.downsideRisk, (1000 + 110000 * dailyRate(10)) / Math.sqrt(2));
  near(result.sortino_ratio, (500 - result.dailyTarget) / result.downsideRisk);
});

test('several accounts combine their own equity and annual benchmarks', () => {
  const result = calculate({ accounts: [account(1, 10, 100000), account(2, 20, 200000)], selected: [1, 2],
    trades: [trade(1, 1, '2026-01-05', -100), trade(2, 2, '2026-01-05', 200)],
    equity: ledger([{ account_id: 1, net_pnl: 50000 }, { account_id: 2, net_pnl: -20000 }]),
  });
  near(result.dailyTarget, 150000 * dailyRate(10) + 180000 * dailyRate(20));
  near(result.avgDailyReturn, 100);
});

test('all-accounts selection combines all configured accounts rather than a fallback', () => {
  const result = calculate({ accounts: [account(1, 300, 0, 'fixed'), account(2, 900, 0, 'fixed')], selected: [],
    trades: [trade(1, 1, '2026-01-05', -100)],
  });
  near(result.dailyTarget, 1200);
});

test('a zero annual benchmark stays zero and fixed dollar targets stay daily', () => {
  near(calculate({ accounts: [account(1, 0, 100000)], trades: [trade(1, 1, '2026-01-05', -500)] }).dailyTarget, 0);
  const result = calculate({ accounts: [account(1, 1000, 0, 'fixed')], trades: [trade(1, 1, '2026-01-05', 500), trade(2, 1, '2026-01-06', 2000)] });
  near(result.dailyTarget, 1000);
  near(result.downsideRisk, 500 / Math.sqrt(2));
  near(result.sortino_ratio, 250 / (500 / Math.sqrt(2)));
});

test('fixed and annual modes can be combined without converting dollar targets', () => {
  const result = calculate({ accounts: [account(1, 10, 100000), account(2, 1000, 0, 'fixed')], selected: [1, 2], trades: [trade(1, 1, '2026-01-05', -100)] });
  near(result.dailyTarget, 100000 * dailyRate(10) + 1000);
});

test('realized samples use closing dates, enforce the reporting window and exclude open trades', () => {
  const trades = [trade(1, 1, '2026-01-05', -100), trade(2, 1, '2026-01-06', 200),
    { ...trade(3, 1, '2026-01-05', 5000), is_open: true }, trade(4, 1, '2026-02-01', 10000)];
  const result = calculate({ accounts: [account(1, 1000, 0, 'fixed')], trades, equity: ledger([], [], '2026-01-05', '2026-01-31') });
  assert.equal(result.daysTraded, 2);
  near(result.avgDailyReturn, 50);
});

test('empty tag subsets do not fall back to a differently configured backend ratio', () => {
  const result = calculate({ accounts: [account(1, 10, 100000)], trades: [trade(1, 1, '2026-01-05', 100)], tags: [1], includeUntagged: false });
  assert.equal(result.sortino_ratio, 0);
  assert.equal(result.daysTraded, 0);
});

test('annual mode reports missing starting value, missing history and nonpositive equity', () => {
  const trades = [trade(1, 1, '2026-01-05', -100)];
  assert.match(calculate({ accounts: [account(1, 10, undefined)], trades }).error, /Starting Account Value/i);
  assert.match(calculate({ accounts: [account(1, 10, 100000)], trades, equity: null }).error, /equity history/i);
  assert.match(calculate({ accounts: [account(1, 10, 100000)], trades, equity: ledger([{ account_id: 1, net_pnl: -110000 }]) }).error, /equity/i);
});

test('account setting serialization preserves zero and rejects invalid percent inputs', () => {
  const parse = module.exports.parseSortinoSettings;
  assert.equal(typeof parse, 'function');
  assert.equal(parse({ sortino_target: '0', sortino_target_mode: 'percent', starting_account_value: '100000' }).sortino_target, 0);
  assert.equal(parse({ sortino_target: '0', sortino_target_mode: 'fixed', starting_account_value: '' }).sortino_target, 0);
  assert.equal(parse({ sortino_target: '0', sortino_target_mode: 'fixed', starting_account_value: '0' }).starting_account_value, 0);
  assert.throws(() => parse({ sortino_target: '10', sortino_target_mode: 'percent', starting_account_value: '' }), /Starting Account Value/);
  assert.throws(() => parse({ sortino_target: '-100', sortino_target_mode: 'percent', starting_account_value: '100000' }), /annual/i);
});

test('complete backend daily groups override a truncated table sample without double-counting tags', () => {
  const equity = ledger([], [{ account_id: 1, date: '2026-01-05', net_pnl: 1500 }]);
  equity.daily_returns = [
    { account_id: 1, date: '2026-01-05', net_pnl: 1000, tag_ids: [1, 2] },
    { account_id: 1, date: '2026-01-05', net_pnl: 500, tag_ids: [] },
  ];
  const result = calculate({ accounts: [account(1, 10, 100000)], trades: [trade(1, 1, '2026-01-05', -999)], equity, tags: [1, 2], includeUntagged: false });
  near(result.avgDailyReturn, 1000);
  assert.equal(result.daysTraded, 1);
});

test('account settings and help guide describe annual benchmarks without zero fallbacks', () => {
  const settings = readFileSync(new URL('../src/components/AccountManagementModal.tsx', import.meta.url), 'utf8');
  assert.match(settings, /<option value="percent">Annual %<\/option>/);
  assert.match(settings, /annual %/);
  assert.equal((settings.match(/settings: parseSortinoSettings\(formData\)/g) ?? []).length, 2);
  assert.doesNotMatch(settings, /parseFloat\(formData.sortino_target\) \|\| 1000/);
  assert.doesNotMatch(source, /sortinoStats.dailyTarget \|\| 1000/);
  const guide = readFileSync(new URL('../src/lib/helpGuide.ts', import.meta.url), 'utf8');
  assert.match(guide, /252/);
  assert.match(guide, /cumulative realized net P&L before the day/);
  assert.match(guide, /saved 5 means 5% per year/);
});
