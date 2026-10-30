// Optional MQTT bridge. Home Assistant publishes a plain word or a JSON
// object to `<topic>/set`; the bridge feeds the shared trigger engine and
// mirrors trigger state back on `<topic>/state`.
//
// Enabled only when `RISCO_MQTT_URL` (or `mqttUrl` in the config) is set, so
// the package can run without a broker. `mqtt` is required lazily.

const { ACTIONS } = require('./trigger');

function makeLogger(logger) {
  return {
    info: (msg) => logger && logger.log && logger.log(`[mqtt] ${msg}`),
    warn: (msg) => logger && (logger.warn || logger.log) && (logger.warn || logger.log)(`[mqtt] ${msg}`),
  };
}

// Plain payloads: `arm`, `stay`, `disarm`, `siren`, `cancel`, `trigger`,
// `trigger 30`, `30`. JSON: `{ "action": "arm", "delay": 30 }`.
function parsePayload(raw, defaultDelay) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, error: 'empty payload' };

  if (text.startsWith('{')) {
    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      return { ok: false, error: `invalid JSON: ${error.message}` };
    }
    if (body.cancel || body.action === 'cancel') return { ok: true, cancel: true };
    return { ok: true, input: { ...body, delay: body.delay ?? 0 } };
  }

  const lower = text.toLowerCase();
  if (lower === 'cancel' || lower === 'abort' || lower === 'stop') return { ok: true, cancel: true };

  const triggerMatch = lower.match(/^trigger(?:\s+(\d+))?$/);
  if (triggerMatch) {
    return { ok: true, input: { action: 'arm', delay: triggerMatch[1] !== undefined ? Number(triggerMatch[1]) : defaultDelay } };
  }

  if (/^\d+$/.test(lower)) return { ok: true, input: { action: 'arm', delay: Number(lower) } };
  if (ACTIONS.includes(lower)) return { ok: true, input: { action: lower, delay: 0 } };

  return { ok: false, error: `unknown command "${text}"` };
}

function startMqttBridge({ runtime, trigger, logger = console }) {
  if (!runtime.mqttUrl) return null;

  let mqtt;
  try {
    mqtt = require('mqtt');
  } catch (error) {
    logger.error && logger.error('[mqtt] RISCO_MQTT_URL is set but the "mqtt" package is missing. Run: npm install');
    return null;
  }

  const log = makeLogger(logger);
  const base = runtime.mqttTopic.replace(/\/+$/, '');
  const setTopic = `${base}/set`;
  const stateTopic = `${base}/state`;
  const defaultDelay = runtime.triggerDelay ?? 30;

  const client = mqtt.connect(runtime.mqttUrl, {
    username: runtime.mqttUsername || undefined,
    password: runtime.mqttPassword || undefined,
    clientId: `risco-control-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 5000,
    will: { topic: stateTopic, payload: JSON.stringify({ online: false }), retain: true },
  });

  function publishState(state) {
    if (!client.connected) return;
    client.publish(stateTopic, JSON.stringify({ online: true, ...state }), { retain: true });
  }

  client.on('connect', () => {
    log.info(`connected to ${runtime.mqttUrl}; listening on ${setTopic}`);
    client.subscribe(setTopic, (error) => {
      if (error) log.warn(`subscribe failed: ${error.message}`);
      publishState(trigger.status());
    });
  });
  client.on('reconnect', () => log.info('reconnecting'));
  client.on('error', (error) => log.warn(error.message));

  client.on('message', (topic, payload) => {
    if (topic !== setTopic) return;
    const parsed = parsePayload(payload.toString(), defaultDelay);
    if (!parsed.ok) {
      log.warn(parsed.error);
      client.publish(`${base}/result`, JSON.stringify({ ok: false, error: parsed.error }));
      return;
    }
    try {
      const result = parsed.cancel ? trigger.cancel('mqtt') : trigger.schedule(parsed.input);
      client.publish(`${base}/result`, JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      log.warn(error.message);
      client.publish(`${base}/result`, JSON.stringify({ ok: false, error: error.message, code: error.code }));
    }
  });

  // The engine tells the bridge when a plan starts, cancels or fires.
  trigger.setOnChange(publishState);

  return { client, publishState, stop: () => client.end(true) };
}

module.exports = { parsePayload, startMqttBridge };
