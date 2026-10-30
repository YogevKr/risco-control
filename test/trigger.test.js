const assert = require('node:assert/strict');
const test = require('node:test');

const { createTrigger, TriggerError } = require('../src/trigger');
const { parsePayload } = require('../src/mqtt');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeCommands() {
  const sent = [];
  return {
    sent,
    async sendCmd(command) { sent.push(command); return 'ACK'; },
  };
}

function makeTrigger(overrides = {}) {
  const commands = fakeCommands();
  const trigger = createTrigger({
    commands,
    runtime: { triggerDelay: 0, ...overrides.runtime },
    controller: { capabilities: () => ({ maxPartitions: 4, maxOutputs: 32 }) },
    logger: null,
  });
  return { trigger, commands };
}

test('an immediate arm plan sends ARM and records the result', async () => {
  const { trigger, commands } = makeTrigger();
  const state = trigger.schedule({ action: 'arm', partition: 2, delay: 0 });
  assert.equal(state.pending, null);
  await wait(5);
  assert.deepEqual(commands.sent, ['ARM=2']);
  assert.equal(trigger.status().last.ok, true);
});

test('a delayed plan fires only after the delay and can be cancelled', async () => {
  const { trigger, commands } = makeTrigger();
  const state = trigger.schedule({ action: 'output', output: 3, delay: 0.1 });
  assert.equal(state.pending.action, 'output');
  await wait(20);
  assert.deepEqual(commands.sent, []);

  const cancelled = trigger.cancel('test');
  assert.equal(cancelled.pending, null);
  assert.equal(cancelled.last.reason, 'test');
  await wait(120);
  assert.deepEqual(commands.sent, []);
});

test('restoreAfter runs the inverse action', async () => {
  const { trigger, commands } = makeTrigger();
  trigger.schedule({ action: 'stay', partition: 1, delay: 0, restoreAfter: 0.05 });
  await wait(100);
  assert.deepEqual(commands.sent, ['STAY=1', 'DISARM=1']);
});

test('the default delay comes from the runtime', () => {
  const { trigger } = makeTrigger({ runtime: { triggerDelay: 45 } });
  const state = trigger.schedule({ action: 'arm' });
  assert.equal(state.pending.action, 'arm');
  trigger.cancel();
});

test('unknown actions and out-of-range ids are rejected', () => {
  const { trigger } = makeTrigger();
  assert.throws(() => trigger.schedule({ action: 'beam' }), TriggerError);
  assert.throws(() => trigger.schedule({ action: 'arm', partition: 9 }), /Invalid partition/);
  assert.throws(() => trigger.schedule({ action: 'output', output: 99 }), /Invalid output/);
  assert.throws(() => trigger.schedule({ action: 'arm', delay: -1 }), /Invalid delay/);
});

test('a new plan replaces a pending one', async () => {
  const { trigger, commands } = makeTrigger();
  trigger.schedule({ action: 'arm', delay: 0.1 });
  trigger.schedule({ action: 'disarm', delay: 0.1 });
  await wait(150);
  assert.deepEqual(commands.sent, ['DISARM=1']);
});

test('a failed panel command is recorded and does not throw', async () => {
  const commands = { sendCmd: async () => { throw new Error('No reply'); } };
  const trigger = createTrigger({
    commands,
    runtime: { triggerDelay: 0 },
    controller: { capabilities: () => ({ maxPartitions: 1, maxOutputs: 1 }) },
    logger: null,
  });
  trigger.schedule({ action: 'arm', delay: 0 });
  await wait(5);
  assert.equal(trigger.status().last.ok, false);
  assert.match(trigger.status().last.error, /No reply/);
});

test('onChange fires when a plan starts, cancels and fires', async () => {
  const { trigger } = makeTrigger();
  const states = [];
  trigger.setOnChange((state) => states.push(state.pending ? state.pending.stage : 'idle'));
  trigger.schedule({ action: 'arm', delay: 0.05 });
  await wait(80);
  assert.deepEqual(states.slice(0, 2), ['fire', 'idle']);
});

test('MQTT payloads accept words, trigger syntax and JSON', () => {
  assert.deepEqual(parsePayload('arm', 30), { ok: true, input: { action: 'arm', delay: 0 } });
  assert.deepEqual(parsePayload('trigger', 30), { ok: true, input: { action: 'arm', delay: 30 } });
  assert.deepEqual(parsePayload('trigger 90', 30), { ok: true, input: { action: 'arm', delay: 90 } });
  assert.deepEqual(parsePayload('15', 30), { ok: true, input: { action: 'arm', delay: 15 } });
  assert.deepEqual(parsePayload('cancel', 30), { ok: true, cancel: true });
  assert.deepEqual(parsePayload('{"action":"stay","delay":5,"partition":2}', 30), {
    ok: true,
    input: { action: 'stay', delay: 5, partition: 2 },
  });
  assert.equal(parsePayload('{"action":"arm"}', 30).input.delay, 0);
  assert.equal(parsePayload('beam', 30).ok, false);
  assert.equal(parsePayload('{oops}', 30).ok, false);
});
