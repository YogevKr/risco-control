const assert = require('node:assert/strict');
const test = require('node:test');

const { getPanelRuntime } = require('./panel-runtime');

const ENV_KEYS = [
  'RISCO_IP',
  'RISCO_PORT',
  'RISCO_PASSWORD',
  'RISCO_PANEL_ID',
  'RISCO_PANEL_TYPE',
  'RISCO_IGNORE_CONFIG',
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
