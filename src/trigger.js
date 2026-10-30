// Delayed panel trigger: Home Assistant (over HTTP or MQTT) asks the server
// to run one panel action after a delay. The delay lets a person disarm or
// close a door before the panel alarms.
//
// The engine never touches the socket itself: it calls `commands.sendCmd`.
// Tests pass a fake command layer and short delays.

const ACTIONS = ['arm', 'stay', 'disarm', 'output', 'siren', 'none'];

// The action that undoes the first one when `restoreAfter` is set.
const RESTORE = { arm: 'disarm', stay: 'disarm', output: 'output' };

// The panel raises a real alarm only while a zone trips on an armed
// partition, so `arm` is the action that produces a siren. `siren` only
// beeps a wireless siren (SNTEST) and `output` pulses a PGM relay.
const ACTION_BUILDERS = {
  arm: (plan) => `ARM=${plan.partition}`,
  stay: (plan) => `STAY=${plan.partition}`,
  disarm: (plan) => `DISARM=${plan.partition}`,
  output: (plan) => `ACTUO${plan.output}`,
  siren: () => 'SNTEST',
  none: () => null,
};

const MAX_DELAY_SECONDS = 86400;
const MAX_RESTORE_SECONDS = 86400;

class TriggerError extends Error {
  constructor(message, status = 400, code = 'bad_trigger') {
    super(message);
    this.name = 'TriggerError';
    this.status = status;
    this.code = code;
  }
}

function toSeconds(value, fallback, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new TriggerError(`Invalid delay "${value}": expected seconds, 0 or more`);
  }
  return Math.min(seconds, max);
}

function toId(value, fallback, max, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || (max && id > max)) {
    throw new TriggerError(`Invalid ${label} "${value}": expected 1..${max || 'n'}`);
  }
  return id;
}

function normalizeAction(input) {
  const action = String(input || 'arm').trim().toLowerCase();
  if (!ACTIONS.includes(action)) {
    throw new TriggerError(`Unknown action "${input}". Expected one of: ${ACTIONS.join(', ')}`);
  }
  return action;
}

// Turns loose HTTP/MQTT input into a validated plan. Capabilities come from
// the live panel so a bad partition or output fails before the delay starts.
function planFromInput(input, { runtime, controller }) {
  const capabilities = (controller && controller.capabilities && controller.capabilities()) || {};
  const maxPartitions = capabilities.maxPartitions || 4;
  const maxOutputs = capabilities.maxOutputs || 32;
  const body = input || {};

  const action = normalizeAction(body.action);
  return {
    action,
    partition: toId(body.partition, 1, maxPartitions, 'partition'),
    output: toId(body.output, 1, maxOutputs, 'output'),
    delay: toSeconds(body.delay, runtime.triggerDelay ?? 30, MAX_DELAY_SECONDS),
    restoreAfter: body.restoreAfter
      ? toSeconds(body.restoreAfter, 0, MAX_RESTORE_SECONDS)
      : 0,
    name: String(body.name || body.source || '').trim().slice(0, 64),
  };
}

function createTrigger({ commands, runtime = {}, controller = null, logger = console, onChange = null }) {
  let counter = 0;
  let pending = null;
  let lastResult = null;
  let listener = onChange;

  function notify() {
    if (typeof listener === 'function') {
      try { listener(status()); } catch (error) { /* a listener must not break the engine */ }
    }
  }

  function setOnChange(fn) {
    listener = typeof fn === 'function' ? fn : null;
  }

  async function runAction(plan, stage) {
    const build = ACTION_BUILDERS[plan.action];
    const command = build(plan);
    if (!command) {
      return { stage, action: plan.action, command: null, ok: true, reply: null, at: new Date() };
    }
    try {
      const reply = await commands.sendCmd(command);
      return { stage, action: plan.action, command, ok: reply === 'ACK', reply, at: new Date() };
    } catch (error) {
      if (logger && logger.warn) logger.warn(`Trigger ${stage} failed: ${error.message}`);
      return { stage, action: plan.action, command, ok: false, error: error.message, at: new Date() };
    }
  }

  async function fire(plan) {
    pending = null;
    const result = await runAction(plan, 'fire');
    lastResult = { ...result, name: plan.name };
    notify();

    const restoreAction = RESTORE[plan.action];
    // A plan scheduled during the command await owns `pending` now; do not
    // clobber it with the restore timer.
    if (plan.restoreAfter > 0 && restoreAction && !pending) {
      const restorePlan = { ...plan, action: restoreAction };
      const timer = setTimeout(() => fireRestore(restorePlan), plan.restoreAfter * 1000);
      if (timer.unref) timer.unref();
      pending = { ...restorePlan, stage: 'restore', at: new Date(Date.now() + plan.restoreAfter * 1000), timer };
      notify();
    }
  }

  async function fireRestore(plan) {
    pending = null;
    const result = await runAction(plan, 'restore');
    lastResult = { ...result, name: plan.name };
    notify();
  }

  // Starts a plan, replacing any pending one.
  function schedule(input) {
    const plan = planFromInput(input, { runtime, controller });
    cancel('replaced');
    const id = ++counter;

    if (plan.delay <= 0) {
      fire(plan);
      return { ...status(), id, at: new Date(), fired: true };
    }

    const timer = setTimeout(() => fire(plan), plan.delay * 1000);
    if (timer.unref) timer.unref();
    pending = { id, ...plan, stage: 'fire', at: new Date(Date.now() + plan.delay * 1000), timer };
    notify();
    return status();
  }

  function cancel(reason = 'cancelled') {
    if (!pending) return status();
    clearTimeout(pending.timer);
    lastResult = {
      id: pending.id,
      stage: 'cancel',
      action: pending.action,
      ok: true,
      reason,
      at: new Date(),
      name: pending.name,
    };
    pending = null;
    notify();
    return status();
  }

  function status() {
    return {
      pending: pending ? {
        id: pending.id,
        stage: pending.stage,
        action: pending.action,
        partition: pending.partition,
        output: pending.output,
        name: pending.name,
        at: pending.at,
      } : null,
      last: lastResult,
    };
  }

  return { schedule, cancel, status, setOnChange, planFromInput };
}

module.exports = { ACTIONS, TriggerError, createTrigger, planFromInput };
