import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/helpGuide.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { helpSections, filterHelpSections } = module.exports;
const topics = helpSections.flatMap(section => section.topics);


test('guide covers the main workflows with unique, populated topics', () => {
  assert.ok(helpSections.length >= 14);
  assert.ok(topics.length >= 45);
  const ids = [...helpSections.map(section => section.id), ...topics.map(topic => topic.id)];
  assert.equal(new Set(ids).size, ids.length);
  for (const section of helpSections) {
    assert.ok(section.title && section.description && section.topics.length);
    for (const topic of section.topics) {
      assert.ok(topic.title && topic.paragraphs.length);
      assert.ok(topic.paragraphs.every(paragraph => paragraph.trim().length > 20));
    }
  }
});

test('public first-user setup documents the operator token and single-owner model', () => {
  const first = topics.find(topic => topic.id === 'first-session');
  const text = [...first.paragraphs, ...(first.steps ?? [])].join(' ');
  assert.match(text, /SETUP_TOKEN/);
  assert.match(text, /single-owner/);
  assert.match(text, /database credentials.*browser/i);
});

test('public troubleshooting preserves CSRF and HTTPS guidance', () => {
  const topic = topics.find(topic => topic.id === 'saving-connection');
  const text = topic.paragraphs.join(' ');
  assert.match(text, /CSRF/);
  assert.match(text, /HTTPS/);
  assert.match(text, /Do not disable/);
});

test('search is case-insensitive and searches body text and keywords', () => {
  const result = filterHelpSections('  SPLIT execution  ').flatMap(section => section.topics);
  assert.ok(result.some(topic => topic.id === 'execution-split'));
  assert.ok(filterHelpSections('pro rata').flatMap(section => section.topics).some(topic => topic.id === 'execution-split'));
  assert.ok(filterHelpSections('Starting Account Value').flatMap(section => section.topics).some(topic => topic.id === 'account-risk-settings'));
});

test('empty search restores the guide and unmatched searches produce no sections', () => {
  assert.equal(filterHelpSections('   '), helpSections);
  assert.equal(filterHelpSections('nonexistent-guide-topic-12345').length, 0);
  const counts = helpSections.map(section => section.topics.length).join(',');
  filterHelpSections('manual matching');
  assert.equal(helpSections.map(section => section.topics.length).join(','), counts);
});

test('destructive and data-changing workflows have explicit warnings', () => {
  for (const id of ['execution-split', 'execution-delete-export', 'trade-recalc-unmatch-delete', 'refresh-recalculate-reprocess', 'import-history', 'trade-create-combine']) {
    assert.ok(topics.find(topic => topic.id === id)?.warning, `Missing warning for ${id}`);
  }
});

test('guide shortcuts point only to existing app destinations', () => {
  const routes = new Set(['/', '/trades', '/executions', '/settings', '/change-password']);
  for (const topic of topics) for (const link of topic.links ?? []) assert.ok(routes.has(link.to));
});

test('the help page is registered behind ProtectedRoute', () => {
  const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(source, /path="\/help"\s+element=\{\s*<ProtectedRoute>\s*<HelpPage\s*\/>\s*<\/ProtectedRoute>/);
});

test('desktop and mobile dashboard controls use the same username menu', () => {
  const header = readFileSync(new URL('../src/components/Header.tsx', import.meta.url), 'utf8');
  assert.equal((header.match(/<UserMenu\b/g) ?? []).length, 2);
  const menu = readFileSync(new URL('../src/components/UserMenu.tsx', import.meta.url), 'utf8');
  assert.match(menu, /navigate\('\/help'\)/);
  for (const label of ['User Help Guide', 'Manage Accounts', 'Import CSV', 'Tag Settings', 'Change Password', 'Logout']) assert.ok(menu.includes(label));
});
