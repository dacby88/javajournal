import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const source = readFileSync(new URL('../src/components/AccountMultiSelect.tsx', import.meta.url), 'utf8');
const helperPath = new URL('../src/lib/accountNamePrivacy.ts', import.meta.url);

function environment(initial, blocked = false, writeBlocked = false) {
  const storage = new Map(initial ? [['account_names_obfuscated', 'true']] : []);
  const window = new EventTarget();
  window.localStorage = {
    getItem(key) { if (blocked) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
    setItem(key, value) { if (blocked || writeBlocked) throw new Error('Storage unavailable'); storage.set(key, value); },
  };
  const helperModule = { exports: {} };
  if (existsSync(helperPath)) vm.runInNewContext(compile(readFileSync(helperPath, 'utf8')), { window, Event, module: helperModule, exports: helperModule.exports });
  return { window, storage, helper: helperModule.exports };
}

function renderSelector(env, selected = [1]) {
  const controls = [];
  const fragment = ({ children }) => React.createElement(React.Fragment, null, children);
  const selectorModule = { exports: {} };
  vm.runInNewContext(compile(source), {
    module: selectorModule, exports: selectorModule.exports,
    require(name) {
      if (name === '@/lib/accountNamePrivacy') return env.helper;
      if (name === '@/lib/utils') return { cn: (...classes) => classes.filter(Boolean).join(' ') };
      if (name === '@/components/ui/popover') return { Popover: fragment, PopoverContent: fragment, PopoverTrigger: fragment };
      if (name === '@/components/ui/button') return { Button: ({ children, ...props }) => React.createElement('button', props, children) };
      if (name === '@/components/ui/input') return { Input: props => React.createElement('input', props) };
      if (name === '@/components/ui/checkbox') return { Checkbox: props => {
        controls.push(props);
        return React.createElement('input', { id: props.id, type: 'checkbox', checked: props.checked, readOnly: true, 'aria-hidden': props['aria-hidden'] });
      } };
      return require(name);
    },
  });
  const accounts = [{ id: 1, name: 'Alpha Account', account_number: 'synthetic-001', is_active: true }, { id: 2, name: 'Beta Account', is_active: false }];
  const changes = [];
  const markup = renderToStaticMarkup(React.createElement(selectorModule.exports.AccountMultiSelect, { accounts, selected, onChange: value => changes.push(value) }));
  return { markup, controls, changes };
}


test('names show at most three characters followed by exactly five stars', () => {
  const { helper } = environment(false);
  assert.equal(typeof helper.formatAccountName, 'function');
  assert.equal(helper.formatAccountName('Alpha Account', true), 'Alp*****');
  assert.equal(helper.formatAccountName('AB', true), 'AB*****');
  assert.equal(helper.formatAccountName('ABC', true), 'ABC*****');
  assert.equal(helper.formatAccountName('Alpha Account', false), 'Alpha Account');
});

test('preference survives remounts and is shared by same-page and storage subscribers', () => {
  const env = environment(false);
  assert.equal(typeof env.helper.setAccountNameObfuscation, 'function');
  let updates = 0;
  const unsubscribe = env.helper.subscribeAccountNameObfuscation(() => { updates++; });
  env.helper.setAccountNameObfuscation(true);
  assert.equal(env.storage.get('account_names_obfuscated'), 'true');
  assert.equal(env.helper.getAccountNameObfuscation(), true);
  assert.equal(updates, 1);
  const event = new Event('storage');
  event.key = 'account_names_obfuscated';
  env.window.dispatchEvent(event);
  assert.equal(updates, 2);
  unsubscribe();
  env.helper.setAccountNameObfuscation(false);
  assert.equal(updates, 2);
  assert.equal(env.helper.getAccountNameObfuscation(), false);
});

test('blocked storage still allows masking for the current page', () => {
  const env = environment(false, true);
  assert.equal(typeof env.helper.setAccountNameObfuscation, 'function');
  env.helper.setAccountNameObfuscation(true);
  assert.equal(env.helper.getAccountNameObfuscation(), true);
  env.helper.setAccountNameObfuscation(false);
  assert.equal(env.helper.getAccountNameObfuscation(), false);
});

test('failed writes use the page preference even when reading old storage still works', () => {
  const env = environment(false, false, true);
  env.helper.setAccountNameObfuscation(true);
  assert.equal(env.helper.getAccountNameObfuscation(), true);
  assert.match(renderSelector(env).markup, /Alp\*{5}/);
});

test('remembered masking covers dropdown rows and the selected trigger without changing selection', () => {
  const env = environment(true);
  const { markup, controls, changes } = renderSelector(env);
  assert.match(markup, /Obfuscate account names/);
  assert.match(markup, /Alp\*{5}/);
  assert.match(markup, /Bet\*{5}/);
  assert.doesNotMatch(markup, /Alpha Account|Beta Account/);
  const option = controls.find(control => control.onCheckedChange);
  assert.equal(option.checked, true);
  option.onCheckedChange(false);
  assert.equal(env.storage.get('account_names_obfuscated'), 'false');
  assert.equal(changes.length, 0);
  assert.match(renderSelector(env).markup, /Alpha Account/);
});

test('all-account and multi-account summary labels remain readable', () => {
  const env = environment(true);
  assert.match(renderSelector(env, []).markup, /All Accounts/);
  assert.match(renderSelector(env, [1, 2]).markup, /2 accounts/);
});
