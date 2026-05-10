const fs = require('fs');
const path = require('path');

const XML_CATALOG = path.join('cs-app', '_176B3E46FC5E6AC9E37206D709D0FAF1');
const ALL_COMMANDS = path.join('data', 'all-commands.txt');
const STATIC_CATALOG = path.join('data', 'command-catalog.json');
const LEGACY_STATIC_CATALOG = 'command-catalog.json';

const ACTION_RE = /^(ACK|ACTUO|ARM|STAY|DISARM|BYP|ZBYPAS|PROG|SAVE|BOOTRES|DEFAULT|CALL|CALLBACK|ALO|ALOC|RFTEST|RFTESTF|BUZZTST|BUZZER|BUZZMIC|SNTEST|LEDTEST|PSTEST|RCMSTEST|VOICETST|VOICEALL|WIFISCAN|WCONNWPS|DEL|CHIMEOFF|BELL|CALIB)/i;
const SENSITIVE_RE = /(PIN|PWD|PASS|ACCID|CODE|PHONE|PHNE|MAIL|IMEI|IMSI|SIMSN|ACCNT|USERNAM|USRNAM|KEYBIN|GSPWD|GPWD|ELASPASS|UPIN|SIMPIN|FMPHONE|FMMAIL|FMCODE|UDACCID)/i;

function text(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return '';
  return match[1]
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .trim();
}

function attr(block, name) {
  const match = block.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match ? match[1].trim() : '';
}

function stripBom(value) {
  return value.replace(/^\uFEFF/, '');
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return stripBom(fs.readFileSync(file, 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function commandBase(command, inheritedFrom) {
  if (inheritedFrom) return inheritedFrom;
  return command.replace(/\d+$/, '');
}

function classify(command, inheritedFrom = '') {
  const base = commandBase(command, inheritedFrom);
  if (base.startsWith('Z2W')) return '2-Way Zones';
  if (base.startsWith('Z') || base.startsWith('RCZ')) return 'Zones';
  if (base.startsWith('UL') || base.startsWith('UP') || base.startsWith('UO') || base === 'U') return 'Users';
  if (base.startsWith('FM')) return 'Follow Me';
  if (base.startsWith('MS') || base.startsWith('RC')) return 'Monitoring';
  if (base.startsWith('G') || base.startsWith('SIM')) return 'GSM';
  if (base.startsWith('IP') || base.startsWith('I')) return 'IP Network';
  if (base.startsWith('ELAS')) return 'RiscoCloud';
  if (base.startsWith('KP')) return 'Keypads';
  if (base.startsWith('FB') || base.startsWith('KF')) return 'Keyfobs';
  if (base.startsWith('RP')) return 'Repeaters';
  if (base.startsWith('IO')) return 'I/O Expanders';
  if (base.startsWith('CAM')) return 'Cameras';
  if (base.startsWith('O')) return 'Outputs';
  if (base.startsWith('P')) return 'Partitions';
  if (base.startsWith('SC')) return 'Schedules';
  if (base.startsWith('VAC')) return 'Vacations';
  if (base.startsWith('S') && !base.startsWith('SWU')) return 'Sirens';
  if (base.startsWith('ANN')) return 'Announcements';
  if (base.startsWith('SWU')) return 'Firmware';
  if (base.startsWith('UD') || base.includes('RMT')) return 'Remote Access';
  if (base.startsWith('PNL') || base.startsWith('SYS') || base === 'CLOCK' || base === 'LANG') return 'System';
  return 'Other';
}

function isActionCommand(command) {
  return ACTION_RE.test(command);
}

function isSensitiveCommand(command) {
  return SENSITIVE_RE.test(command);
}

function kindFor(command, traffic, sensitive, action) {
  if (action) return 'action';
  if (sensitive) return 'sensitive';
  if (traffic === 'Receive') return 'status';
  if (traffic === 'Send') return 'write';
  if (traffic === 'All') return 'setting';
  return 'unknown';
}

function parseXmlCommands(xmlPath) {
  if (!fs.existsSync(xmlPath)) return [];
  const xml = stripBom(fs.readFileSync(xmlPath, 'utf8'));
  const blocks = xml.match(/<Command(?:\s[^>]*)?>[\s\S]*?<\/Command>/g) || [];
  const baseMeta = new Map();
  const parsed = [];

  for (const block of blocks) {
    const command = text(block, 'VariantName');
    if (!command) continue;

    const entry = {
      command,
      inheritedFrom: text(block, 'InherentFrom'),
      text: text(block, 'Text') || command,
      format: text(block, 'Format'),
      offset: text(block, 'Offset'),
      description: attr(block, 'Description'),
      crc: text(block, 'CRCName'),
      traffic: text(block, 'Traffic'),
      valueType: text(block, 'ValueType'),
      category: text(block, 'Category'),
      password: text(block, 'Password'),
      encrypted: text(block, 'Encrypted'),
      min: text(block, 'Minimum'),
      max: text(block, 'Maximum'),
      legality: text(block, 'Legality'),
      source: 'cs-xml',
    };

    if (!entry.inheritedFrom && entry.traffic) {
      baseMeta.set(command, entry);
    }
    parsed.push(entry);
  }

  return parsed.map((entry) => {
    const inherited = entry.inheritedFrom ? baseMeta.get(entry.inheritedFrom) : null;
    return {
      ...entry,
      traffic: entry.traffic || inherited?.traffic || '',
      valueType: entry.valueType || inherited?.valueType || '',
      category: entry.category || inherited?.category || '',
      password: entry.password || inherited?.password || '',
      encrypted: entry.encrypted || inherited?.encrypted || '',
      min: entry.min || inherited?.min || '',
      max: entry.max || inherited?.max || '',
      legality: entry.legality || inherited?.legality || '',
      crc: entry.crc || inherited?.crc || '',
      base: commandBase(entry.command, entry.inheritedFrom),
    };
  });
}

function latestAuditFile(root) {
  if (!fs.existsSync(root)) return null;
  const files = fs.readdirSync(root)
    .filter((name) => /^risco-deep-audit-.*\.json$/.test(name))
    .map((name) => {
      const fullPath = path.join(root, name);
      return { name, fullPath, mtime: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] || null;
}

function loadSupportSnapshots(root) {
  const supported = new Map();
  const supportedPath = path.join(root, 'supported-commands.json');
  if (fs.existsSync(supportedPath)) {
    try {
      for (const key of Object.keys(JSON.parse(fs.readFileSync(supportedPath, 'utf8')))) {
        supported.set(key.replace(/<n>/g, ''), { source: 'legacy-supported', supported: true });
      }
    } catch (error) {}
  }

  const audit = latestAuditFile(root);
  const categoryStats = {};
  if (audit) {
    try {
      const data = JSON.parse(fs.readFileSync(audit.fullPath, 'utf8'));
      Object.assign(categoryStats, data.categoryStats || {});
      for (const [command, result] of Object.entries(data.results || {})) {
        supported.set(command, {
          source: 'deep-audit',
          supported: !!result.supported,
          rawClass: result.rawClass || '',
          category: result.category || '',
        });
      }
    } catch (error) {}
  }

  return { supported, categoryStats, auditFile: audit ? 'deep-audit' : null };
}

function buildCommandCatalog(root = process.cwd()) {
  const byCommand = new Map();
  const xmlPath = path.join(root, XML_CATALOG);
  const allCommandsPath = path.join(root, ALL_COMMANDS);
  const { supported, categoryStats, auditFile } = loadSupportSnapshots(root);

  for (const entry of parseXmlCommands(xmlPath)) {
    byCommand.set(entry.command, entry);
  }

  for (const command of readLines(allCommandsPath)) {
    if (!byCommand.has(command)) {
      byCommand.set(command, { command, text: command, base: commandBase(command, ''), source: 'all-commands' });
    }
  }

  const commands = [...byCommand.values()]
    .map((entry) => {
      const action = isActionCommand(entry.command);
      const sensitive = isSensitiveCommand(entry.command) || entry.password === 'True';
      const support = supported.get(entry.command) || supported.get(entry.base) || null;
      const traffic = entry.traffic || '';
      const readable = !action && !sensitive && traffic !== 'Send';
      return {
        command: entry.command,
        base: entry.base || commandBase(entry.command, entry.inheritedFrom),
        text: entry.text || entry.command,
        format: entry.format || '',
        offset: entry.offset || '',
        inheritedFrom: entry.inheritedFrom || '',
        category: classify(entry.command, entry.inheritedFrom),
        csCategory: entry.category || '',
        description: entry.description || '',
        traffic,
        valueType: entry.valueType || '',
        legality: entry.legality || '',
        min: entry.min || '',
        max: entry.max || '',
        crc: entry.crc || '',
        encrypted: entry.encrypted || '',
        source: entry.source || 'unknown',
        support: support ? support.supported : null,
        supportSource: support ? support.source : '',
        supportClass: support ? support.rawClass || '' : '',
        liveCategory: support ? support.category || '' : '',
        action,
        sensitive,
        readable,
        writable: traffic === 'All' && !action,
        kind: kindFor(entry.command, traffic, sensitive, action),
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.command.localeCompare(b.command, undefined, { numeric: true }));

  const categories = [...new Set(commands.map((command) => command.category))].sort();
  const meta = {
    generatedAt: new Date().toISOString(),
    sources: {
      xmlCatalog: fs.existsSync(xmlPath) ? XML_CATALOG : null,
      allCommands: fs.existsSync(allCommandsPath) ? ALL_COMMANDS : null,
      auditFile,
    },
    commandCount: commands.length,
    baseCount: new Set(commands.map((command) => command.base)).size,
    readableCount: commands.filter((command) => command.readable).length,
    actionCount: commands.filter((command) => command.action).length,
    sensitiveCount: commands.filter((command) => command.sensitive).length,
    liveSupportedCount: commands.filter((command) => command.support === true).length,
    liveUnsupportedCount: commands.filter((command) => command.support === false).length,
    categoryStats,
  };

  return { meta, categories, commands };
}

function candidateCatalogPaths(root = process.cwd()) {
  const binaryDir = path.dirname(process.execPath);
  return [
    path.join(root, STATIC_CATALOG),
    path.join(root, LEGACY_STATIC_CATALOG),
    path.join(binaryDir, STATIC_CATALOG),
    path.join(binaryDir, LEGACY_STATIC_CATALOG),
  ];
}

function loadCommandCatalog(root = process.cwd()) {
  for (const candidate of candidateCatalogPaths(root)) {
    if (fs.existsSync(candidate)) {
      try {
        return JSON.parse(fs.readFileSync(candidate, 'utf8'));
      } catch (error) {}
    }
  }
  return buildCommandCatalog(root);
}

function summarizeCommands(commands) {
  return {
    count: commands.length,
    readableCount: commands.filter((command) => command.readable).length,
    actionCount: commands.filter((command) => command.action).length,
    sensitiveCount: commands.filter((command) => command.sensitive).length,
    supportedCount: commands.filter((command) => command.support === true).length,
    unsupportedCount: commands.filter((command) => command.support === false).length,
    unknownCount: commands.filter((command) => command.support === null).length,
  };
}

function buildCommandMenu(catalog) {
  const categoryMap = new Map();
  for (const command of catalog.commands || []) {
    if (!categoryMap.has(command.category)) categoryMap.set(command.category, new Map());
    const baseMap = categoryMap.get(command.category);
    if (!baseMap.has(command.base)) baseMap.set(command.base, []);
    baseMap.get(command.base).push(command);
  }

  const categories = [...categoryMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, baseMap]) => {
      const bases = [...baseMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(([base, commands]) => {
          const sortedCommands = commands.sort((a, b) => a.command.localeCompare(b.command, undefined, { numeric: true }));
          return {
            base,
            ...summarizeCommands(sortedCommands),
            commands: sortedCommands,
          };
        });
      const commands = bases.flatMap((base) => base.commands);
      return {
        name,
        baseCount: bases.length,
        ...summarizeCommands(commands),
        bases,
      };
    });

  return {
    meta: catalog.meta,
    categories,
  };
}

function maskPanelResponse(command, response) {
  if (!isSensitiveCommand(command)) return response;
  if (typeof response !== 'string') return '{present}';
  if (!response.includes('=')) return response ? '{present}' : response;
  return response.replace(/=.*/, '={present}');
}

module.exports = {
  buildCommandCatalog,
  buildCommandMenu,
  isActionCommand,
  isSensitiveCommand,
  loadCommandCatalog,
  maskPanelResponse,
};
