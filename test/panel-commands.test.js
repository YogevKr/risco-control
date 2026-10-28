const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCommandLayer,
  validateLabel,
  isLabelCommand,
  LABEL_MAX,
} = require('../src/panel-commands');

// In-memory panel: answers reads from `values`, stores writes, can drop replies.
function fakeTransport({ values = {}, dropOnce = [], ready = true } = {}) {
  const store = { ...values };
  const sent = [];
  const pendingDrops = new Set(dropOnce);
  return {
    sent,
    store,
    ready,
    isReady() { return this.ready; },
    async send(command) {
      sent.push(command);
      if (pendingDrops.has(command)) {
        pendingDrops.delete(command);
        return undefined; // simulates a timeout
      }
      if (command === 'PROG=1' || command === 'PROG=2') return 'ACK';
      const write = command.match(/^([A-Z0-9]+)=(.*)$/);
      if (write) {
        store[write[1]] = write[2];
        return 'ACK';
      }
      const batch = command.match(/^([A-Z0-9]+)\*(\d+):(\d+)\?$/);
      if (batch) {
        const base = batch[1];
        if (store[`${base}*batch`] === false) return 'N05';
        const parts = [];
        for (let id = Number(batch[2]); id <= Number(batch[3]); id++) parts.push(store[`${base}${id}`] ?? '');
        return `${base}=${parts.join('\t')}`;
      }
      const read = command.match(/^([A-Z0-9]+)\*?(\d*)\?$/);
      if (read) {
        const key = `${read[1]}${read[2]}`;
        return store[key] === undefined ? 'N05' : `${key}=${store[key]}`;
      }
      return 'ACK';
    },
  };
}

test('validateLabel enforces the panel limit', () => {
  assert.equal(validateLabel('  חלון חדר משחקים '), 'חלון חדר משחקים');
  assert.equal(Array.from('חלון חדר משחקים').length, 15);
  assert.throws(() => validateLabel('x'.repeat(LABEL_MAX + 1)), /at most 16/);
  assert.throws(() => validateLabel(''), /must not be empty/);
  assert.throws(() => validateLabel('bad\u0007label'), /control characters/);
  const error = (() => { try { validateLabel('x'.repeat(20)); } catch (e) { return e; } return null; })();
  assert.equal(error.status, 400);
  assert.equal(error.code, 'label_too_long');
});

test('isLabelCommand recognises indexed label commands only', () => {
  assert.equal(isLabelCommand('ZLBL10'), true);
  assert.equal(isLabelCommand('KPLABEL1'), true);
  assert.equal(isLabelCommand('SYSLBL'), true);
  assert.equal(isLabelCommand('ZTYPE10'), false);
});

test('readCmd strips the command echo', async () => {
  const transport = fakeTransport({ values: { ZLBL10: 'חלון הורים' } });
  const commands = createCommandLayer({ transport, logger: null });
  assert.equal(await commands.readCmd('ZLBL*10'), 'חלון הורים');
  assert.deepEqual(transport.sent, ['ZLBL*10?']);
});

test('a lost reply is retried, then fails with a 504 error', async () => {
  const transport = fakeTransport({ values: { ZLBL9: 'דלת כניסה' }, dropOnce: ['ZLBL*9?'] });
  const commands = createCommandLayer({ transport, logger: null });
  assert.equal(await commands.readCmd('ZLBL*9'), 'דלת כניסה');
  assert.equal(commands.stats().retries, 1);
  assert.equal(commands.stats().timeouts, 1);

  const dead = fakeTransport();
  dead.send = async function (command) { this.sent.push(command); return undefined; };
  const deadCommands = createCommandLayer({ transport: dead, logger: null, retries: 2 });
  await assert.rejects(deadCommands.readCmd('ZSTT*1'), (e) => e.status === 504 && e.code === 'timeout');
  assert.equal(dead.sent.length, 3, 'one send plus two retries');

  const noRetry = fakeTransport();
  noRetry.send = async function (command) { this.sent.push(command); return undefined; };
  const noRetryCommands = createCommandLayer({ transport: noRetry, logger: null, retries: 0 });
  await assert.rejects(noRetryCommands.readCmd('ZSTT*1'), /No reply/);
  assert.equal(noRetry.sent.length, 1);
});

test('output activation is not retried after a lost reply', async () => {
  const transport = fakeTransport();
  transport.send = async function (command) { this.sent.push(command); return undefined; };
  const commands = createCommandLayer({ transport, logger: null });
  await assert.rejects(commands.sendCmd('ACTUO3'), /No reply/);
  assert.deepEqual(transport.sent, ['ACTUO3']);
});

test('commands are rejected with 503 while the panel is not connected', async () => {
  const transport = fakeTransport({ ready: false });
  const commands = createCommandLayer({ transport, logger: null });
  await assert.rejects(commands.readCmd('PNLVER'), (e) => e.status === 503 && e.code === 'not_connected');
  assert.equal(transport.sent.length, 0);
});

test('writeEntries wraps writes in programming mode and reads labels back', async () => {
  const transport = fakeTransport({ values: { ZLBL10: 'חלון הורים', ZTYPE10: '5' } });
  const writes = [];
  const commands = createCommandLayer({ transport, logger: null, onWrite: (info) => writes.push(info) });

  const entries = commands.buildWriteEntries({ label: 'חלון חדר משחקים', type: 5 }, { label: 'ZLBL', type: 'ZTYPE' }, 10);
  const results = await commands.writeEntries(entries);

  assert.deepEqual(transport.sent, ['PROG=1', 'ZLBL10=חלון חדר משחקים', 'ZTYPE10=5', 'PROG=2', 'ZLBL*10?']);
  assert.equal(results.label, 'ACK');
  assert.equal(results.labelReadBack, 'חלון חדר משחקים');
  assert.equal(results.labelVerified, true);
  assert.equal(results.typeVerified, undefined);
  assert.deepEqual(writes, [{ commands: ['ZLBL10', 'ZTYPE10'] }]);
});

test('buildWriteEntries rejects an over-long label before touching the panel', () => {
  const transport = fakeTransport();
  const commands = createCommandLayer({ transport, logger: null });
  assert.throws(
    () => commands.buildWriteEntries({ label: 'this label is far too long for a panel' }, { label: 'ZLBL' }, 10),
    (e) => e.status === 400 && e.code === 'label_too_long'
  );
  assert.equal(transport.sent.length, 0);
});

test('writeCmd validates labels and leaves programming mode on failure', async () => {
  const transport = fakeTransport();
  const commands = createCommandLayer({ transport, logger: null });
  await assert.rejects(commands.writeCmd('SYSLBL', 'x'.repeat(17)), /at most 16/);
  assert.equal(transport.sent.length, 0);

  assert.equal(await commands.writeCmd('ENTRDLY', 30), 'ACK');
  assert.deepEqual(transport.sent, ['PROG=1', 'ENTRDLY=30', 'PROG=2']);
});

test('batchReadOrFallback uses one batch read when the panel supports it', async () => {
  const transport = fakeTransport({ values: { ZLNKTYP1: 'E', ZLNKTYP2: 'W', ZLNKTYP3: 'N' } });
  const commands = createCommandLayer({ transport, logger: null });
  assert.deepEqual(await commands.batchReadOrFallback('ZLNKTYP', [1, 2, 3]), ['E', 'W', 'N']);
  assert.deepEqual(transport.sent, ['ZLNKTYP*1:3?']);
});

test('batchReadOrFallback falls back to per-id reads, only for the wanted ids, and remembers N05', async () => {
  const transport = fakeTransport({ values: { 'ZRSSI*batch': false, ZRSSI2: '31', ZRSSI3: '40' } });
  const commands = createCommandLayer({ transport, logger: null });
  const values = await commands.batchReadOrFallback('ZRSSI', [1, 2, 3], { only: [2] });
  assert.deepEqual(values, ['', '31', '']);
  assert.deepEqual(transport.sent, ['ZRSSI*1:3?', 'ZRSSI2?']);

  // The panel said N05 to the batch form: the next call skips the batch attempt.
  const again = await commands.batchReadOrFallback('ZRSSI', [1, 2, 3], { only: [3] });
  assert.deepEqual(again, ['', '', '40']);
  assert.deepEqual(transport.sent.slice(2), ['ZRSSI3?']);
  assert.deepEqual(commands.stats().batchUnsupported, ['ZRSSI']);
});

test('batch replies keep empty leading and trailing fields', async () => {
  const transport = fakeTransport({ values: { ZRRI2: 'x' } });
  const commands = createCommandLayer({ transport, logger: null });
  assert.deepEqual(await commands.batchRead('ZRRI', 1, 3), ['', 'x', '']);
});
