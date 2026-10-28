const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { getPanelRuntime, loadConfig, saveConfig, resolveConfigPath } = require('../src/panel-runtime');

const ENV_KEYS = [
  'RISCO_IP',
  'RISCO_PORT',
  'RISCO_PASSWORD',
  'RISCO_PANEL_ID',
  'RISCO_PANEL_TYPE',
  'RISCO_IGNORE_CONFIG',
  'RISCO_CONFIG_PATH',
  'RISCO_DISCOVER_CODE',
  'RISCO_DEBUG',
  'RISCO_LOG_LEVEL',
  'RISCO_API_TOKEN',
  'RISCO_ALLOWED_HOSTS',
  'RISCO_ALLOWED_ORIGINS',
  'RISCO_ZONES_CACHE_MS',
  'HOST',
  'PORT',
];

function withEnv(overrides, fn) {
  const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

  for (const key of ENV_KEYS) {
    delete process.env[key];
  }

  Object.assign(process.env, overrides);

  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = original.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function withTempConfig(initial, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risco-runtime-'));
  const file = path.join(dir, 'risco-config.json');
  if (initial !== null) fs.writeFileSync(file, JSON.stringify(initial), { mode: 0o644 });
  try {
    return withEnv({ RISCO_CONFIG_PATH: file }, () => fn(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('getPanelRuntime returns documented defaults', () => {
  withEnv({ RISCO_IGNORE_CONFIG: '1' }, () => {
    const runtime = getPanelRuntime();

    assert.equal(runtime.panelType, 'LightSys');
    assert.equal(runtime.panelOptions.Panel_IP, '127.0.0.1');
    assert.equal(runtime.panelOptions.Panel_Port, 1000);
    assert.equal(runtime.panelOptions.Panel_Password, 5678);
    assert.equal(runtime.panelOptions.Panel_Id, '0001');
    assert.equal(runtime.host, '127.0.0.1');
    assert.equal(runtime.port, 3580);
    assert.equal(runtime.loopbackOnly, true);
    assert.equal(runtime.logLevel, 'error');
    assert.equal(runtime.apiToken, '');
    assert.deepEqual(runtime.allowedHosts, []);
    assert.equal(runtime.zonesCacheMs, 30000);
  });
});

test('access-code discovery is off unless asked for', () => {
  withEnv({ RISCO_IGNORE_CONFIG: '1' }, () => {
    assert.equal(getPanelRuntime().panelOptions.DiscoverCode, false);
    assert.equal(getPanelRuntime().discoverCode, false);
  });
  withEnv({ RISCO_IGNORE_CONFIG: '1', RISCO_DISCOVER_CODE: '1' }, () => {
    assert.equal(getPanelRuntime().panelOptions.DiscoverCode, true);
  });
  withTempConfig({ discoverCode: true }, () => {
    assert.equal(getPanelRuntime().panelOptions.DiscoverCode, true);
  });
  assert.throws(
    () => withEnv({ RISCO_IGNORE_CONFIG: '1', RISCO_DISCOVER_CODE: 'maybe' }, () => getPanelRuntime()),
    /Invalid boolean env RISCO_DISCOVER_CODE: maybe/
  );
});

test('log level comes from RISCO_DEBUG, RISCO_LOG_LEVEL or the config', () => {
  withEnv({ RISCO_IGNORE_CONFIG: '1', RISCO_DEBUG: '1' }, () => assert.equal(getPanelRuntime().logLevel, 'debug'));
  withEnv({ RISCO_IGNORE_CONFIG: '1', RISCO_LOG_LEVEL: 'verbose' }, () => assert.equal(getPanelRuntime().logLevel, 'verbose'));
  assert.throws(
    () => withEnv({ RISCO_IGNORE_CONFIG: '1', RISCO_LOG_LEVEL: 'loud' }, () => getPanelRuntime()),
    /Invalid RISCO_LOG_LEVEL "loud"/
  );
});

test('network and auth settings are read from env and config', () => {
  withEnv({ RISCO_IGNORE_CONFIG: '1', HOST: '0.0.0.0', RISCO_API_TOKEN: 't0k', RISCO_ALLOWED_HOSTS: 'risco.lan, panel.home:3580' }, () => {
    const runtime = getPanelRuntime();
    assert.equal(runtime.loopbackOnly, false);
    assert.equal(runtime.apiToken, 't0k');
    assert.deepEqual(runtime.allowedHosts, ['risco.lan', 'panel.home:3580']);
  });
  withTempConfig({ apiToken: 'from-file', allowedHosts: ['a.lan'], zonesCacheMs: 5 }, () => {
    const runtime = getPanelRuntime();
    assert.equal(runtime.apiToken, 'from-file');
    assert.deepEqual(runtime.allowedHosts, ['a.lan']);
    assert.equal(runtime.zonesCacheMs, 5);
  });
});

test('getPanelRuntime rejects invalid integer env values', () => {
  assert.throws(
    () => withEnv({ RISCO_PORT: 'abc' }, () => getPanelRuntime()),
    /Invalid integer env RISCO_PORT: abc/
  );
});

test('getPanelRuntime rejects unsupported panel types', () => {
  assert.throws(
    () => withEnv({ RISCO_PANEL_TYPE: 'BadPanel' }, () => getPanelRuntime()),
    /Unsupported RISCO_PANEL_TYPE "BadPanel"/
  );
});

test('RISCO_CONFIG_PATH selects the config file for reads and writes', () => {
  withTempConfig({ panelIp: '192.0.2.10', panelPassword: 1234, installerPin: '1234' }, (file) => {
    assert.equal(resolveConfigPath(), file);
    assert.equal(loadConfig().panelIp, '192.0.2.10');
    assert.equal(getPanelRuntime().panelOptions.Panel_IP, '192.0.2.10');
    assert.equal(getPanelRuntime().configPath, file);

    const saved = saveConfig({ panelIp: '192.0.2.20' });
    assert.equal(saved.path, file);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(stored.panelIp, '192.0.2.20');
    assert.equal(stored.panelPassword, 1234, 'merge keeps the other keys');
    assert.equal(stored.installerPin, '1234');
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'config is owner-only');
    assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false);
  });
});

test('saveConfig creates the file when none exists and drops undefined keys', () => {
  withTempConfig(null, (file) => {
    assert.equal(resolveConfigPath(), file, 'an explicit RISCO_CONFIG_PATH is used even before the file exists');
    assert.deepEqual(loadConfig(), {});
    const saved = saveConfig({ panelIp: '10.0.0.5', panelType: undefined });
    assert.equal(saved.path, file);
    assert.deepEqual(saved.config, { panelIp: '10.0.0.5' });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { panelIp: '10.0.0.5' });
  });
});
