const fs = require('fs');
const path = require('path');
const { buildCommandCatalog } = require('../src/command-catalog');

const repoRoot = path.resolve(__dirname, '..');
const catalog = buildCommandCatalog(repoRoot);
const outPath = path.join(repoRoot, 'data', 'command-catalog.json');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o644 });

console.log(JSON.stringify({
  outPath,
  commandCount: catalog.meta.commandCount,
  baseCount: catalog.meta.baseCount,
  readableCount: catalog.meta.readableCount,
  liveSupportedCount: catalog.meta.liveSupportedCount,
}, null, 2));
