import assert from 'node:assert/strict';
import { after } from 'node:test';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});
after(() => server.close());
const { OpenTradeNetPnlFigures, sumOpenPositionPnl } = await server.ssrLoadModule('/src/components/OpenTradeNetPnlFigures.tsx');

const render = (props) => renderToStaticMarkup(React.createElement(OpenTradeNetPnlFigures, props));

test('an open trade with no quote shows only net cash', () => {
  const markup = render({ isOpen: true, pnl: null, netCash: -250.5 });
  assert.match(markup, /Net Cash/);
  assert.match(markup, /-\$250\.50/);
  assert.doesNotMatch(markup, /Net Cash:/);
  assert.equal(sumOpenPositionPnl([null]), null);
  assert.equal(sumOpenPositionPnl([120, null]), null);
});

test('an open trade with a quote shows open P&L and net cash', () => {
  const markup = render({ isOpen: true, pnl: 80, netCash: -20 });
  assert.match(markup, /\$80\.00/);
  assert.match(markup, /Net Cash: -\$20\.00/);
  assert.equal(sumOpenPositionPnl([50, 30]), 80);
});

test('a closed trade shows realized P&L without a net-cash line', () => {
  const markup = render({ isOpen: false, pnl: -15, netCash: -15 });
  assert.match(markup, /-\$15\.00/);
  assert.doesNotMatch(markup, /Net Cash/);
});
