const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { buildCommandCatalog, buildCommandMenu, isActionCommand, isSensitiveCommand, maskPanelResponse } = require('../src/command-catalog');

const repoRoot = path.join(__dirname, '..');

test('builds full command catalog from CS XML and command list', () => {
  const catalog = buildCommandCatalog(repoRoot);
  const names = new Set(catalog.commands.map((entry) => entry.command));

  assert.ok(catalog.meta.commandCount > 5000);
  assert.ok(catalog.meta.baseCount >= 350);
  assert.ok(names.has('ZTYPE1'));
  assert.ok(names.has('UDACCID'));
  assert.ok(names.has('GRSSI'));
});

test('classifies action and sensitive commands', () => {
  assert.equal(isActionCommand('DISARM'), true);
  assert.equal(isActionCommand('ZTYPE1'), false);
  assert.equal(isSensitiveCommand('UPIN1'), true);
  assert.equal(isSensitiveCommand('ZTYPE1'), false);
});

test('builds menu tree by category and command family', () => {
  const catalog = buildCommandCatalog(repoRoot);
  const menu = buildCommandMenu(catalog);
  const zones = menu.categories.find((category) => category.name === 'Zones');
  const ztype = zones.bases.find((base) => base.base === 'ZTYPE');

  assert.ok(zones.count > 0);
  assert.ok(ztype.commands.some((command) => command.command === 'ZTYPE1'));
});

test('masks sensitive panel responses', () => {
  assert.equal(maskPanelResponse('UPIN1', 'UPIN1=1234'), 'UPIN1={present}');
  assert.equal(maskPanelResponse('ZTYPE1', 'ZTYPE1=0'), 'ZTYPE1=0');
});
