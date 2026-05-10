const fs = require('fs');
const path = require('path');
const { buildCommandCatalog } = require('./command-catalog');

const catalog = buildCommandCatalog(__dirname);
const outPath = path.join(__dirname, 'command-catalog.json');

fs.writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o644 });

console.log(JSON.stringify({
  outPath,
  commandCount: catalog.meta.commandCount,
  baseCount: catalog.meta.baseCount,
  readableCount: catalog.meta.readableCount,
  liveSupportedCount: catalog.meta.liveSupportedCount,
}, null, 2));
