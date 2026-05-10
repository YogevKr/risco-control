const RiscoTCPPanel = require('risco-lan-bridge');
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  panelIp: '192.168.40.199',
  panelPort: 1000,
  panelPassword: 5678,
  panelId: '0001',
  panelType: 'LightSys',
  host: '127.0.0.1',
  port: 3580,
});

// Config file lives next to the executable (works in .app bundles)
const CONFIG_PATH = path.join(path.dirname(process.execPath), 'risco-config.json');

function loadConfig() {
  if (process.env.RISCO_IGNORE_CONFIG === '1') {
    return {};
  }
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load config:', e.message);
  }
  // Also try next to source (for development)
  try {
    const devPath = path.join(__dirname, 'risco-config.json');
    if (fs.existsSync(devPath)) {
      return JSON.parse(fs.readFileSync(devPath, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    // Fall back to source directory
    const devPath = path.join(__dirname, 'risco-config.json');
    fs.writeFileSync(devPath, JSON.stringify(config, null, 2));
  }
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

function getPanelRuntime() {
  const config = loadConfig();

  const panelType = process.env.RISCO_PANEL_TYPE || config.panelType || DEFAULTS.panelType;
  const PanelCtor = RiscoTCPPanel[panelType];

  if (typeof PanelCtor !== 'function') {
    throw new Error(
      `Unsupported RISCO_PANEL_TYPE "${panelType}". Expected one of: ${supportedPanelTypes.join(', ')}`
    );
  }

  return {
    PanelCtor,
    panelType,
    panelOptions: {
      Panel_IP: process.env.RISCO_IP || config.panelIp || DEFAULTS.panelIp,
      Panel_Port: parseEnvInt('RISCO_PORT', config.panelPort || DEFAULTS.panelPort),
      Panel_Password: parseEnvInt('RISCO_PASSWORD', config.panelPassword || DEFAULTS.panelPassword),
      Panel_Id: process.env.RISCO_PANEL_ID || config.panelId || DEFAULTS.panelId,
      AutoDiscover: true,
      DiscoverCode: true,
      AutoConnect: true,
      SocketMode: 'direct',
    },
    host: process.env.HOST || config.host || DEFAULTS.host,
    port: parseEnvInt('PORT', config.port || DEFAULTS.port),
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
  DEFAULTS,
  createPanel,
  getPanelRuntime,
  loadConfig,
  parseEnvInt,
  saveConfig,
  supportedPanelTypes,
};
