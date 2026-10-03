import assert from 'node:assert/strict';
import { after } from 'node:test';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
after(() => server.close());
const { HelpPage } = await server.ssrLoadModule('/src/components/HelpPage.tsx');
const render = route => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [route] }, React.createElement(HelpPage)));


test('guide renders its search, section navigation and first-session instructions', () => {
  const markup = render('/help');
  assert.match(markup, /Get more from your trading journal/);
  assert.match(markup, /Search the user guide/);
  assert.match(markup, /Help guide sections/);
  assert.match(markup, /Your first session/);
  assert.match(markup, /does not place orders/);
  assert.match(markup, /SETUP_TOKEN/);
  assert.match(markup, /single-owner/);
  assert.match(markup, /href="\/help#trade-details"/);
});

test('deep-linked search expands matching instructions and warnings', () => {
  const markup = render('/help?q=split%20execution');
  assert.match(markup, /Split an execution into smaller quantities/);
  assert.match(markup, /fractional child quantities/);
  assert.match(markup, /Before you proceed/);
  assert.doesNotMatch(markup, /Your first session/);
});

test('unknown search terms render a recoverable empty state', () => {
  const markup = render('/help?q=nonexistent-guide-topic-12345');
  assert.match(markup, /No topics found/);
  assert.match(markup, /Show all topics/);
  assert.match(markup, /0 of 50 topics/);
});

test('a section bookmark expands that section on initial rendering', () => {
  const markup = render('/help#trade-details');
  assert.match(markup, /Also recalculate account stats/);
  assert.match(markup, /custom description/);
  assert.match(markup, /Reassign &amp; Recalculate/);
});
