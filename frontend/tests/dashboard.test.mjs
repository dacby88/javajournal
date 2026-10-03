import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'App');
const declaration = app.body.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
  .find(node => node.name.getText(file) === 'fetchData');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = data => ({ success: true, data });

function harness() {
  const state = { data: null, trades: [], error: null, loading: true, refreshing: true };
  const dashboards = [], trades = [];
  const pending = (queue, accounts) => new Promise((resolve, reject) => queue.push({ accounts, resolve, reject }));
  const context = vm.createContext({ Date, Error, dashboardRequestId: { current: 0 }, selectedPeriod: 'all', customDateRange: undefined,
    api: { getDashboard: (_y, _m, accounts) => pending(dashboards, accounts), getAllTrades: (_s, _e, accounts) => pending(trades, accounts) },
    setData: value => { state.data = value; }, setAllTrades: value => { state.trades = value; },
    setError: value => { state.error = value; }, setLoading: value => { state.loading = value; }, setIsRefreshing: value => { state.refreshing = value; },
  });
  const fetch = vm.runInContext(compile(`(selectedAccounts) => (${declaration.initializer.arguments[0].getText(file)})`), context);
  return { state, dashboards, trades, fetch };
}

async function complete(h, index, value) {
  h.dashboards[index].resolve(response(value));
  await flush();
  h.trades.at(-1).resolve(response([value]));
  await flush();
}

test('a slower multi-account request cannot replace the latest single account', async () => {
  const h = harness();
  const old = h.fetch([1, 2])(), latest = h.fetch([2])();
  await complete(h, 1, 'single-account');
  h.dashboards[0].resolve(response('multiple-accounts'));
  await Promise.all([old, latest]);
  assert.equal(h.state.data, 'single-account');
  assert.deepEqual(h.state.trades, ['single-account']);
  assert.equal(h.trades.length, 1);
});

test('a stale trades response cannot overwrite account-derived chart data', async () => {
  const h = harness();
  const old = h.fetch([1, 2])();
  h.dashboards[0].resolve(response('multiple-accounts'));
  await flush();
  const latest = h.fetch([2])();
  await complete(h, 1, 'single-account');
  h.trades[0].resolve(response(['multiple-accounts']));
  await Promise.all([old, latest]);
  assert.deepEqual(h.state.trades, ['single-account']);
});

test('stale errors cannot stop the current refresh', async () => {
  const h = harness();
  const old = h.fetch([1, 2])(), latest = h.fetch([2])();
  h.dashboards[0].reject(new Error('obsolete failure'));
  await old;
  assert.equal(h.state.error, null);
  assert.equal(h.state.refreshing, true);
  await complete(h, 1, 'single-account');
  await latest;
  assert.equal(h.state.refreshing, false);
});

test('manual refreshes with unchanged accounts still ignore stale responses', async () => {
  const h = harness();
  const old = h.fetch([2])(), latest = h.fetch([2])();
  await complete(h, 1, 'latest');
  h.dashboards[0].resolve(response('old'));
  await Promise.all([old, latest]);
  assert.equal(h.state.data, 'latest');
});

const detail = ts.createSourceFile('TradeDetailPage.tsx', readFileSync(new URL('../src/components/TradeDetailPage.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let title;
function findTitle(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(detail) === 'SimpleNav') {
    title = node.attributes.properties.find(attr => attr.name?.getText(detail) === 'title').initializer.expression;
  }
  ts.forEachChild(node, findTitle);
}
findTitle(detail);

test('trade header shows its account and preserves the combined badge', () => {
  const context = vm.createContext({ React, trade: { id: 42, account_name: 'Synthetic account' }, combineHistory: { is_combined: true },
    Badge: ({ children }) => React.createElement('span', null, children), Link2: () => null,
  });
  const markup = renderToStaticMarkup(vm.runInContext(compile(`(${title.getText(detail)})`), context));
  assert.match(markup, /Trade #42/);
  assert.match(markup, /Synthetic account/);
  assert.match(markup, /Combined/);
});
