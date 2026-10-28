// Panel connection lifecycle: reachability probe, library logging, ready
// state, health snapshot and the "config changed in programming mode" flag.

const net = require('net');
const { createPanel } = require('./panel-runtime');

const LEVELS = { error: 0, warn: 1, info: 2, verbose: 3, debug: 4 };
const SECRET_COMMANDS = /((?:RMT|UPIN|INSTPIN|SUBPIN|SIMPIN|ELASPASS|UDACCID|GPWD|GSPWD|IUSRPWD|FB2WPIN|KPBYPCOD)\d*=)[^\s]*/gi;

function maskSecrets(message) {
  return String(message).replace(SECRET_COMMANDS, '$1****');
}

// risco-lan-bridge calls logger(log, level, message); level is a lowercase
// string. Everything at or below the configured level is printed, with
// access codes and PINs masked.
function makeLibraryLogger(level, out = console) {
  const threshold = LEVELS[level] ?? LEVELS.error;
  const logger = (log, lvl, message) => {
    const name = String(lvl || 'debug').toLowerCase();
    if ((LEVELS[name] ?? LEVELS.debug) > threshold) return;
    const line = `[panel:${name}] ${maskSecrets(message)}`;
    if (name === 'error' || name === 'warn') out.error(line);
    else out.log(line);
  };
  const log = {
    error: (message) => logger(null, 'error', message),
    warn: (message) => logger(null, 'warn', message),
    info: (message) => logger(null, 'info', message),
    debug: (message) => logger(null, 'debug', message),
  };
  return { logger, log };
}

function probeTcp(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, error: error || null, ms: Date.now() - started });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, `no answer within ${timeoutMs} ms`));
    socket.once('error', (err) => finish(false, err.code || err.message));
    socket.connect(port, host);
  });
}

function createPanelController(runtime, { out = console, readyTimeoutMs = 45000 } = {}) {
  const { Panel_IP: host, Panel_Port: port, Panel_Id: panelId } = runtime.panelOptions;
  const state = {
    panel: null,
    tcp: null,
    ready: false,
    readySince: null,
    startedAt: new Date(),
    connectAttempts: 0,
    lastError: null,
    lastProbe: null,
    configChangedAt: null,
    lastWriteAt: null,
  };
  const { logger, log } = makeLibraryLogger(runtime.logLevel, out);
  let readyTimer = null;

  // The library keeps its own ProgModeOn handler, which starts a 60-second
  // warning loop that never stops. Replace it with a flag that /api/health
  // reports and /api/reconnect clears.
  function hookProgMode() {
    const system = state.panel && state.panel.MBSystem;
    if (!system || typeof system.removeAllListeners !== 'function') return;
    system.removeAllListeners('ProgModeOn');
    system.on('ProgModeOn', () => {
      state.configChangedAt = new Date();
    });
  }

  function onReady() {
    state.tcp = state.panel.RiscoComm.TCPSocket;
    state.ready = true;
    state.readySince = new Date();
    state.lastError = null;
    clearTimeout(readyTimer);
    out.log('Panel connected and ready.');
    hookProgMode();
  }

  function onError(err) {
    state.ready = false;
    state.lastError = { at: new Date(), message: String((err && err.message) || err) };
    out.error(`Panel error: ${state.lastError.message}`);
  }

  async function connect() {
    state.connectAttempts += 1;
    out.log(`Connecting to ${runtime.panelType} panel at ${host}:${port} (panel id ${panelId})`);

    const probe = await probeTcp(host, port);
    state.lastProbe = { ...probe, at: new Date() };
    if (probe.ok) {
      out.log(`TCP port open at ${host}:${port} (${probe.ms} ms). Waiting for the panel handshake (about 10 s).`);
    } else {
      out.error(
        `Cannot reach the panel at ${host}:${port}: ${probe.error}. ` +
        'Check the IP, the VLAN and the firewall. The library keeps retrying in the background.'
      );
    }

    ({ panel: state.panel } = createPanel({ logger, log }));
    state.panel.on('SystemInitComplete', onReady);
    state.panel.on('PanelCommError', onError);

    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      if (state.ready) return;
      const hint = probe.ok
        ? 'The port is open but the handshake did not complete: check the access code, the panel id, and that this is the panel remote port.'
        : 'The port is closed or filtered.';
      out.error(`No panel handshake after ${Math.round(readyTimeoutMs / 1000)} s. ${hint}`);
    }, readyTimeoutMs);
    if (readyTimer.unref) readyTimer.unref();
  }

  async function disconnect() {
    clearTimeout(readyTimer);
    state.ready = false;
    state.tcp = null;
    if (state.panel) {
      try { await state.panel.Disconnect(true); } catch (error) { /* already closed */ }
    }
    state.panel = null;
  }

  async function reconnect() {
    await disconnect();
    state.configChangedAt = null;
    await connect();
  }

  const transport = {
    isReady: () => state.ready && !!state.tcp,
    send: (command, prog) => state.tcp.SendCommand(command, prog),
  };

  function noteWrite() {
    state.lastWriteAt = new Date();
  }

  // Limits the library learned from the panel type (RP432 = 32 zones, ...).
  function capabilities() {
    const panel = state.panel;
    return {
      maxZones: (panel && Number.isInteger(panel.MaxZones) && panel.MaxZones > 0) ? panel.MaxZones : null,
      maxOutputs: (panel && Number.isInteger(panel.MaxOutputs) && panel.MaxOutputs > 0) ? panel.MaxOutputs : null,
      maxPartitions: (panel && Number.isInteger(panel.MaxParts) && panel.MaxParts > 0) ? panel.MaxParts : null,
    };
  }

  function status() {
    return {
      connected: transport.isReady(),
      capabilities: capabilities(),
      readySince: state.readySince,
      uptimeSeconds: Math.round((Date.now() - state.startedAt.getTime()) / 1000),
      connectAttempts: state.connectAttempts,
      lastError: state.lastError,
      lastProbe: state.lastProbe,
      configChangedAt: state.configChangedAt,
      lastWriteAt: state.lastWriteAt,
      panel: { host, port, panelId, type: runtime.panelType },
    };
  }

  return { connect, disconnect, reconnect, transport, status, capabilities, noteWrite, state };
}

module.exports = { createPanelController, makeLibraryLogger, maskSecrets, probeTcp };
