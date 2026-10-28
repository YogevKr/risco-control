const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createApp } = require('../src/app');
const { createCommandLayer } = require('../src/panel-commands');

// Minimal catalog: enough for the menu and the /api/commands routes.
const catalog = {
  meta: { commandCount: 2, baseCount: 2, readableCount: 1, liveSupportedCount: 1 },
  categories: ['zones'],
  commands: [
    { command: 'ZLBL', base: 'ZLBL', category: 'zones', description: 'Zone label', kind: 'setting', readable: true, support: true, action: false, sensitive: false },
    { command: 'UPIN', base: 'UPIN', category: 'users', description: '', kind: 'secret', readable: false, support: true, action: false, sensitive: true },
  ],
};

function fakePanel({ values = {}, ready = true } = {}) {
  const store = { ...values };
  const sent = [];
  const transport = {
    ready,
    isReady() { return this.ready; },
    async send(command) {
      sent.push(command);
      if (command === 'PROG=1' || command === 'PROG=2') return 'ACK';
      const write = command.match(/^([A-Z0-9]+)=(.*)$/);
      if (write) { store[write[1]] = write[2]; return 'ACK'; }
      const batch = command.match(/^([A-Z0-9]+)\*(\d+):(\d+)\?$/);
      if (batch) {
        const parts = [];
        for (let id = Number(batch[2]); id <= Number(batch[3]); id++) parts.push(store[`${batch[1]}${id}`] ?? '');
        return `${batch[1]}=${parts.join('\t')}`;
      }
      const read = command.match(/^([A-Z0-9]+)\*?(\d*)\?$/);
      if (read) {
        const key = `${read[1]}${read[2]}`;
        return store[key] === undefined ? 'N05' : `${key}=${store[key]}`;
      }
      return 'ACK';
    },
  };
  const controller = {
    transport,
    reconnects: 0,
    writes: [],
    noteWrite(info) { this.writes.push(info); },
    async reconnect() { this.reconnects += 1; },
    capabilities() { return { maxZones: 32, maxOutputs: null, maxPartitions: null }; },
    status() {
      return {
        connected: transport.isReady(),
        readySince: null,
        uptimeSeconds: 1,
        connectAttempts: 1,
        lastError: null,
        lastProbe: { ok: true, ms: 3 },
        configChangedAt: null,
        lastWriteAt: null,
        panel: { host: '127.0.0.1', port: 1000, panelId: '0001', type: 'LightSys' },
      };
    },
  };
  return { transport, controller, sent, store };
}

function runtimeWith(overrides = {}) {
  return {
    host: '127.0.0.1',
    port: 0,
    apiToken: '',
    allowedHosts: [],
    allowedOrigins: [],
    zonesCacheMs: 30000,
    configPath: null,
    ...overrides,
  };
}

async function startApp({ runtime = runtimeWith(), panel = fakePanel(), onConfigChange } = {}) {
  const commands = createCommandLayer({ transport: panel.transport, logger: null, onWrite: (info) => panel.controller.noteWrite(info) });
  const app = createApp({ commands, controller: panel.controller, catalog, runtime, rootDir: path.join(__dirname, '..'), onConfigChange });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, route, { body, headers = {} } = {}) => {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch (error) { /* non-JSON body */ }
    return { status: response.status, json, text };
  };
  return { app, server, base, request, panel, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('health reports 503 until the panel is connected, 200 afterwards', async () => {
  const panel = fakePanel({ ready: false });
  const ctx = await startApp({ panel });
  try {
    const down = await ctx.request('GET', '/api/health');
    assert.equal(down.status, 503);
    assert.equal(down.json.connected, false);
    assert.equal(down.json.panel.host, '127.0.0.1');

    panel.transport.ready = true;
    const up = await ctx.request('GET', '/api/health');
    assert.equal(up.status, 200);
    assert.equal(up.json.connected, true);
    assert.equal(typeof up.json.commands.commands, 'number');
  } finally {
    await ctx.close();
  }
});

test('API calls fail with 503 and a code while the panel is not connected', async () => {
  const ctx = await startApp({ panel: fakePanel({ ready: false }) });
  try {
    const r = await ctx.request('GET', '/api/zones/10');
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'not_connected');
  } finally {
    await ctx.close();
  }
});

test('zone label writes are validated, written in programming mode and read back', async () => {
  const panel = fakePanel({ values: { ZLBL10: 'חלון הורים', ZTYPE10: '5', ZSTT10: '------------', ZLNKTYP10: 'W', ZRSSI10: '31', ZRRI10: '', ZCONF10: '0', ZFORCE10: '0' } });
  const ctx = await startApp({ panel });
  try {
    const tooLong = await ctx.request('POST', '/api/zones/10/config', { body: { label: 'x'.repeat(17) } });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.json.code, 'label_too_long');
    assert.equal(panel.sent.length, 0);

    const ok = await ctx.request('POST', '/api/zones/10/config', { body: { label: 'חלון חדר משחקים' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.results.label, 'ACK');
    assert.equal(ok.json.results.labelVerified, true);
    assert.deepEqual(panel.sent, ['PROG=1', 'ZLBL10=חלון חדר משחקים', 'PROG=2', 'ZLBL*10?']);
    assert.equal(panel.controller.writes.length, 1);
  } finally {
    await ctx.close();
  }
});

test('/api/setting validates labels and reports timeouts as 504', async () => {
  const panel = fakePanel();
  const ctx = await startApp({ panel });
  try {
    const bad = await ctx.request('PUT', '/api/setting', { body: { command: 'SYSLBL', value: 'x'.repeat(17) } });
    assert.equal(bad.status, 400);

    panel.transport.send = async function (command) { panel.sent.push(command); return command.startsWith('PROG') ? 'ACK' : undefined; };
    const timeout = await ctx.request('PUT', '/api/setting', { body: { command: 'ENTRDLY', value: 30 } });
    assert.equal(timeout.status, 504);
    assert.equal(timeout.json.code, 'timeout');
  } finally {
    await ctx.close();
  }
});

test('/api/zones uses batch reads and serves the cache until a write', async () => {
  const values = {};
  for (let id = 1; id <= 50; id++) {
    values[`ZTYPE${id}`] = id <= 2 ? '5' : '0';
    values[`ZLBL${id}`] = id === 1 ? 'Door' : id === 2 ? 'Window' : `${String(id).padStart(2, '0')} zone`;
    values[`ZSTT${id}`] = id <= 2 ? '------------' : '-----------N';
    values[`ZLNKTYP${id}`] = id === 2 ? 'W' : id === 1 ? 'E' : 'N';
  }
  Object.assign(values, { ZRSSI2: '31', ZRRI2: '27/07/2026 15:17', ZRSSITIM2: '28/10/2026 06:00', Z2WPRSNS2: '1', Z2WMWSNS2: '1', Z2WPLSCN2: '1', Z2WENLED2: '1' });
  const panel = fakePanel({ values });
  const ctx = await startApp({ panel });
  try {
    const first = await ctx.request('GET', '/api/zones');
    assert.equal(first.status, 200);
    assert.deepEqual(first.json.map((zone) => zone.id), [1, 2]);
    assert.equal(first.json[1].tech, 'W');
    assert.equal(first.json[1].rssi, 0x31);
    assert.equal(first.json[1].wireless.pirSensitivity, 1);
    const commandsForFirst = panel.sent.length;
    // 32 zones = 4 chunks x 4 batch reads, plus 7 wireless batch reads for chunk 1
    assert.equal(commandsForFirst, 4 * 4 + 7, `expected batch reads, got ${commandsForFirst} commands: ${panel.sent.join(' ')}`);

    await ctx.request('GET', '/api/zones');
    assert.equal(panel.sent.length, commandsForFirst, 'second call is served from the cache');

    const all = await ctx.request('GET', '/api/zones?all=1');
    assert.equal(all.json.length, 32, 'stops at the panel zone limit');
    assert.equal(panel.sent.length, commandsForFirst);

    await ctx.request('POST', '/api/zones/1/config', { body: { label: 'Front door' } });
    await ctx.request('GET', '/api/zones');
    assert.ok(panel.sent.length > commandsForFirst + 4, 'a write drops the cache');
  } finally {
    await ctx.close();
  }
});

test('raw commands are passed through without retry and mark writes', async () => {
  const panel = fakePanel({ values: { PNLVER: '6.07' } });
  const ctx = await startApp({ panel });
  try {
    const read = await ctx.request('POST', '/api/raw', { body: { command: 'PNLVER?' } });
    assert.equal(read.json.response, 'PNLVER=6.07');
    const empty = await ctx.request('POST', '/api/raw', { body: {} });
    assert.equal(empty.status, 400);
    await ctx.request('POST', '/api/raw', { body: { command: 'ENTRDLY=20', prog: true } });
    assert.equal(panel.controller.writes.length, 1);
  } finally {
    await ctx.close();
  }
});

test('an API token is required on every /api route except health', async () => {
  const ctx = await startApp({ runtime: runtimeWith({ apiToken: 'secret-token' }) });
  try {
    assert.equal((await ctx.request('GET', '/api/health')).status, 200);
    assert.equal((await ctx.request('GET', '/api/system')).status, 401);
    assert.equal((await ctx.request('GET', '/api/system', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    const ok = await ctx.request('GET', '/api/config', { headers: { Authorization: 'Bearer secret-token' } });
    assert.equal(ok.status, 200);
    const viaHeader = await ctx.request('GET', '/api/config', { headers: { 'X-API-Token': 'secret-token' } });
    assert.equal(viaHeader.status, 200);
    assert.equal((await ctx.request('GET', '/')).status, 200, 'the UI itself stays reachable');
  } finally {
    await ctx.close();
  }
});

// fetch() drops a custom Host header, so this test uses the raw http client.
function rawGet(base, route, headers) {
  const url = new URL(base + route);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, path: url.pathname, method: 'GET', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('unknown Host headers are rejected, IP literals and allowed names pass', async () => {
  const ctx = await startApp({ runtime: runtimeWith({ allowedHosts: ['risco.home.lan:3580'] }) });
  try {
    assert.equal(await rawGet(ctx.base, '/api/health', { Host: 'evil.example.com' }), 403);
    assert.equal(await rawGet(ctx.base, '/api/health', { Host: 'risco.home.lan' }), 200);
    assert.equal(await rawGet(ctx.base, '/api/health', { Host: '192.168.1.20:3580' }), 200);
    assert.equal(await rawGet(ctx.base, '/api/health', { Host: '[::1]:3580' }), 200);
    assert.equal(await rawGet(ctx.base, '/api/health', { Host: 'localhost:3580' }), 200);
    assert.equal((await ctx.request('GET', '/api/health', { headers: { Origin: 'http://evil.example.com' } })).status, 403);
    assert.equal((await ctx.request('GET', '/api/health', { headers: { Origin: 'http://localhost:0' } })).status, 200);
  } finally {
    await ctx.close();
  }
});

test('PUT /api/config merges into the stored file and keeps it private', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risco-config-'));
  const file = path.join(dir, 'risco-config.json');
  fs.writeFileSync(file, JSON.stringify({ panelIp: '192.0.2.10', panelPassword: 5678, installerPin: '1234' }), { mode: 0o644 });
  const previous = process.env.RISCO_CONFIG_PATH;
  process.env.RISCO_CONFIG_PATH = file;
  const changes = [];
  const ctx = await startApp({ runtime: runtimeWith({ configPath: file }), onConfigChange: async (config) => changes.push(config) });
  try {
    const empty = await ctx.request('PUT', '/api/config', { body: {} });
    assert.equal(empty.status, 400);
    const badType = await ctx.request('PUT', '/api/config', { body: { panelType: 'Nope' } });
    assert.equal(badType.status, 400);

    const r = await ctx.request('PUT', '/api/config', { body: { panelIp: '192.0.2.20' } });
    assert.equal(r.status, 200);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(stored.panelIp, '192.0.2.20');
    assert.equal(stored.panelPassword, 5678, 'untouched keys survive');
    assert.equal(stored.installerPin, '1234');
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(changes.length, 1);

    const shown = await ctx.request('GET', '/api/config');
    assert.equal(shown.json.panelIp, '192.0.2.20');
    assert.equal(shown.json.panelPasswordSet, true);
  } finally {
    await ctx.close();
    if (previous === undefined) delete process.env.RISCO_CONFIG_PATH; else process.env.RISCO_CONFIG_PATH = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reconnect drops the zone cache and asks the controller to reconnect', async () => {
  const panel = fakePanel();
  const ctx = await startApp({ panel });
  try {
    const r = await ctx.request('POST', '/api/reconnect');
    assert.equal(r.status, 200);
    assert.equal(panel.controller.reconnects, 1);
  } finally {
    await ctx.close();
  }
});
