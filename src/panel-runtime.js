const RiscoTCPPanel = require('risco-lan-bridge');
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  panelIp: '127.0.0.1',
  panelPort: 1000,
  panelPassword: 5678,
  panelId: '0001',
  panelType: 'LightSys',
  host: '127.0.0.1',
  port: 3580,
  // Never brute-force the remote access code unless asked for explicitly.
  discoverCode: false,
  // Library log level: error | warn | info | verbose | debug
  logLevel: 'error',
  zonesCacheMs: 30000,
  // Lost replies: how many times a command is sent again (bounded by the
  // library's 5-second timeout per attempt).
  commandRetries: 2,
  // Delayed trigger: default seconds between a Home Assistant event and the
  // panel action. 0 fires at once.
  triggerDelay: 30,
  // Optional MQTT bridge. Empty RISCO_MQTT_URL disables it.
  mqttUrl: '',
  mqttTopic: 'risco/control',
  mqttUsername: '',
  mqttPassword: '',
});

const CONFIG_FILE = 'risco-config.json';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOG_LEVELS = ['error', 'warn', 'info', 'verbose', 'debug'];

function isBundledBinary() {
  const base = path.basename(process.execPath).toLowerCase().replace(/\.exe$/, '');
  return !['node', 'bun', 'deno'].includes(base);
}

// Config file lives next to the executable for the .app bundle and the compiled
// binary; next to the source tree when running from source. RISCO_CONFIG_PATH
// overrides both.
function configCandidates() {
  const execDir = path.join(path.dirname(process.execPath), CONFIG_FILE);
  const cwdPath = path.join(process.cwd(), CONFIG_FILE);
  return isBundledBinary() ? [execDir, cwdPath] : [cwdPath, execDir];
}

function resolveConfigPath({ forWrite = false } = {}) {
  if (process.env.RISCO_CONFIG_PATH) return process.env.RISCO_CONFIG_PATH;
  const candidates = configCandidates();
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (existing) return existing;
  return forWrite ? candidates[0] : null;
}

function readJsonFile(filePath) {
  if (!filePath) return {};
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`Failed to load config ${filePath}:`, e.message);
  }
  return {};
}

function loadConfig() {
  if (process.env.RISCO_IGNORE_CONFIG === '1') {
    return {};
  }
  return readJsonFile(resolveConfigPath());
}

// Merges `partial` into the stored config and writes it with owner-only
// permissions (the file holds the panel access code and installer PINs).
function saveConfig(partial, { merge = true } = {}) {
  const target = resolveConfigPath({ forWrite: true });
  const next = merge ? { ...readJsonFile(target), ...partial } : { ...partial };
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key];
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, target);
  return { path: target, config: next };
}

const supportedPanelTypes = Object.keys(RiscoTCPPanel)
  .filter((key) => typeof RiscoTCPPanel[key] === 'function')
  .sort();

function parseEnvInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer env ${name}: ${raw}`);
  }

  return parsed;
}

function parseEnvBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`Invalid boolean env ${name}: ${raw}`);
}

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host || '').trim().toLowerCase());
}

function resolveLogLevel(config) {
  if (process.env.RISCO_DEBUG === '1') return 'debug';
  const level = String(process.env.RISCO_LOG_LEVEL || config.logLevel || DEFAULTS.logLevel).toLowerCase();
  if (!LOG_LEVELS.includes(level)) {
    throw new Error(`Invalid RISCO_LOG_LEVEL "${level}". Expected one of: ${LOG_LEVELS.join(', ')}`);
  }
  return level;
}

function getPanelRuntime() {
  const config = loadConfig();

  const panelType = process.env.RISCO_PANEL_TYPE || config.panelType || DEFAULTS.panelType;
  const PanelCtor = RiscoTCPPanel[panelType];

  if (typeof PanelCtor !== 'function') {
    throw new Error(
      `Unsupported RISCO_PANEL_TYPE "${panelType}". Expected one of: ${supportedPanelTypes.join(', ')}`
    );
  }

  const discoverCode = parseEnvBool(
    'RISCO_DISCOVER_CODE',
    typeof config.discoverCode === 'boolean' ? config.discoverCode : DEFAULTS.discoverCode
  );
  const host = process.env.HOST || config.host || DEFAULTS.host;

  return {
    PanelCtor,
    panelType,
    panelOptions: {
      Panel_IP: process.env.RISCO_IP || config.panelIp || DEFAULTS.panelIp,
      Panel_Port: parseEnvInt('RISCO_PORT', config.panelPort || DEFAULTS.panelPort),
      Panel_Password: parseEnvInt('RISCO_PASSWORD', config.panelPassword || DEFAULTS.panelPassword),
      Panel_Id: process.env.RISCO_PANEL_ID || config.panelId || DEFAULTS.panelId,
      AutoDiscover: true,
      DiscoverCode: discoverCode,
      AutoConnect: true,
      SocketMode: 'direct',
    },
    host,
    port: parseEnvInt('PORT', config.port || DEFAULTS.port),
    loopbackOnly: isLoopbackHost(host),
    discoverCode,
    logLevel: resolveLogLevel(config),
    apiToken: String(process.env.RISCO_API_TOKEN || config.apiToken || ''),
    allowedHosts: parseList(process.env.RISCO_ALLOWED_HOSTS || config.allowedHosts),
    allowedOrigins: parseList(process.env.RISCO_ALLOWED_ORIGINS || config.allowedOrigins),
    zonesCacheMs: parseEnvInt('RISCO_ZONES_CACHE_MS', config.zonesCacheMs ?? DEFAULTS.zonesCacheMs),
    commandRetries: parseEnvInt('RISCO_COMMAND_RETRIES', config.commandRetries ?? DEFAULTS.commandRetries),
    triggerDelay: parseEnvInt('RISCO_TRIGGER_DELAY', config.triggerDelay ?? DEFAULTS.triggerDelay),
    mqttUrl: String(process.env.RISCO_MQTT_URL || config.mqttUrl || DEFAULTS.mqttUrl).trim(),
    mqttTopic: String(process.env.RISCO_MQTT_TOPIC || config.mqttTopic || DEFAULTS.mqttTopic).trim(),
    mqttUsername: String(process.env.RISCO_MQTT_USERNAME || config.mqttUsername || DEFAULTS.mqttUsername),
    mqttPassword: String(process.env.RISCO_MQTT_PASSWORD || config.mqttPassword || DEFAULTS.mqttPassword),
    configPath: resolveConfigPath(),
    supportedPanelTypes,
  };
}

function createPanel(optionOverrides = {}) {
  const runtime = getPanelRuntime();
  const panelOptions = { ...runtime.panelOptions, ...optionOverrides };

  return {
    panel: new runtime.PanelCtor(panelOptions),
    panelOptions,
    panelType: runtime.panelType,
    host: runtime.host,
    port: runtime.port,
    supportedPanelTypes: runtime.supportedPanelTypes,
  };
}

module.exports = {
  CONFIG_FILE,
  DEFAULTS,
  LOG_LEVELS,
  createPanel,
  getPanelRuntime,
  isLoopbackHost,
  loadConfig,
  parseEnvBool,
  parseEnvInt,
  resolveConfigPath,
  saveConfig,
  supportedPanelTypes,
};
