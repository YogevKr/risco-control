// Command layer: serialises panel commands, retries one lost reply, wraps
// writes in programming mode, validates labels and reads them back.
//
// `transport` is anything with `isReady()` and `send(command, prog)` that
// resolves to the panel reply string, or `undefined` when the reply timed out.
// The real transport is the risco-lan-bridge socket; tests pass a fake.

const LABEL_MAX = 16;

// Commands that must not be repeated after a lost reply: the panel may have
// executed them already and a second run has a visible effect.
const NO_RETRY = /^ACTUO/i;

class CommandError extends Error {
  constructor(message, status = 500, code = 'command_failed') {
    super(message);
    this.name = 'CommandError';
    this.status = status;
    this.code = code;
  }
}

function isLabelCommand(command) {
  return /(LBL|LABEL)\d*$/.test(String(command || '').toUpperCase());
}

// Panel labels hold at most 16 characters; longer values are cut silently
// by the panel, so reject them here with a clear message.
function validateLabel(value) {
  const label = String(value ?? '').trim();
  if (!label) throw new CommandError('Label must not be empty', 400, 'label_empty');
  if (/[\u0000-\u001f\u007f]/.test(label)) {
    throw new CommandError('Label must not contain control characters', 400, 'label_control_chars');
  }
  const length = Array.from(label).length;
  if (length > LABEL_MAX) {
    throw new CommandError(
      `Label is ${length} characters; the panel stores at most ${LABEL_MAX}`,
      400,
      'label_too_long'
    );
  }
  return label;
}

function normalizeWriteValue(value) {
  return typeof value === 'boolean' ? Number(value) : value;
}

// Keeps values out of logs and error messages.
function describeCommand(command) {
  return String(command || '').replace(/=.*$/, '=…');
}

// The panel drops roughly one reply in ten, in bursts right after the
// handshake. Each lost reply costs the library's 5-second timeout, so the
// default of two retries bounds a command at about 15 s.
const DEFAULT_RETRIES = 2;
const RETRY_DELAY_MS = 250;

function createCommandLayer({ transport, logger = console, onWrite = null, retryTimeouts = true, retries = DEFAULT_RETRIES }) {
  let queue = Promise.resolve();
  const stats = { commands: 0, retries: 0, timeouts: 0, lastCommandAt: null };
  const writeListeners = onWrite ? [onWrite] : [];
  // Commands the panel answered with N05 in batch form; read them per id.
  const batchUnsupported = new Set();

  // Anything that caches panel state (the zone list, the controller's
  // lastWriteAt) subscribes here and is told after every write.
  function addWriteListener(listener) {
    writeListeners.push(listener);
  }

  function notifyWrite(info) {
    for (const listener of writeListeners) {
      try { listener(info); } catch (error) { /* a listener must not break a write */ }
    }
  }

  function sendCmd(command, prog = false, options = {}) {
    if (!transport.isReady()) {
      return Promise.reject(new CommandError('Panel not connected', 503, 'not_connected'));
    }
    const allowRetry = options.retry !== undefined ? options.retry : (retryTimeouts && !NO_RETRY.test(command));
    const attempts = allowRetry ? 1 + Math.max(0, retries) : 1;
    const run = queue.then(async () => {
      stats.commands += 1;
      stats.lastCommandAt = new Date();
      let reply;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (attempt > 1) {
          stats.retries += 1;
          if (logger && logger.warn) logger.warn(`No reply to ${describeCommand(command)}; retry ${attempt - 1} of ${attempts - 1}`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
        reply = await transport.send(command, prog);
        if (reply !== undefined) break;
        stats.timeouts += 1;
      }
      if (reply === undefined) {
        throw new CommandError(`No reply from the panel for ${describeCommand(command)}`, 504, 'timeout');
      }
      return reply;
    });
    queue = run.catch(() => {}); // keep the queue alive after errors
    return run;
  }

  // Promise.all is enough: the queue already runs commands one at a time.
  const sequential = (promises) => Promise.all(promises);

  async function readCmd(command, prog = false) {
    const reply = await sendCmd(`${command}?`, prog);
    if (reply && reply.includes('=')) return reply.split('=').slice(1).join('=').trim();
    return reply;
  }

  async function safeReadCmd(command, fallback = '') {
    try {
      const value = await readCmd(command);
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  // Batch replies are tab separated and may start or end with empty fields,
  // so split the raw reply instead of the trimmed readCmd value. Returns
  // null when the panel rejects the batch form (N05 and friends).
  function splitBatch(reply) {
    if (typeof reply !== 'string') return [];
    const body = reply.includes('=') ? reply.slice(reply.indexOf('=') + 1) : reply;
    if (/^N\d\d$/.test(body.trim())) return null;
    if (body === '') return [];
    return body.split('\t').map((value) => value.trim());
  }

  async function batchRead(command, min, max) {
    const values = splitBatch(await sendCmd(`${command}*${min}:${max}?`));
    if (values === null) {
      batchUnsupported.add(command);
      return [];
    }
    return values;
  }

  async function safeBatchRead(command, min, max) {
    try {
      return await batchRead(command, min, max);
    } catch (error) {
      return [];
    }
  }

  // One batch read for a contiguous id range. Falls back to one read per id
  // when the panel does not answer the batch form for this command. `only`
  // limits the fallback reads to the ids that matter (others get '').
  async function batchReadOrFallback(command, ids, { star = false, only = null } = {}) {
    if (!ids.length) return [];
    if (!batchUnsupported.has(command)) {
      try {
        const values = await batchRead(command, ids[0], ids[ids.length - 1]);
        if (values.length === ids.length) return values;
      } catch (error) {
        // fall through to per-id reads
      }
    }
    const wanted = only ? new Set(only) : null;
    const out = [];
    for (const id of ids) {
      if (wanted && !wanted.has(id)) {
        out.push('');
        continue;
      }
      out.push(await safeReadCmd(star ? `${command}*${id}` : `${command}${id}`, ''));
    }
    return out;
  }

  async function withProgrammingMode(work) {
    await sendCmd('PROG=1', true);
    try {
      return await work();
    } finally {
      try { await sendCmd('PROG=2', true); } catch (error) { /* already out of programming mode */ }
    }
  }

  async function writeCmd(command, value) {
    const cleanValue = isLabelCommand(command) ? validateLabel(value) : normalizeWriteValue(value);
    const reply = await withProgrammingMode(() => sendCmd(`${command}=${cleanValue}`, true));
    notifyWrite({ commands: [command] });
    return reply;
  }

  function buildWriteEntries(body, commands, suffix = '') {
    return Object.entries(commands)
      .filter(([key]) => body[key] !== undefined)
      .map(([key, base]) => {
        const command = `${base}${suffix}`;
        const label = isLabelCommand(command);
        return {
          key,
          base,
          suffix: String(suffix),
          command,
          label,
          value: label ? validateLabel(body[key]) : normalizeWriteValue(body[key]),
        };
      });
  }

  // Writes all entries inside one programming-mode session, then reads every
  // indexed label back so the caller can see what the panel stored.
  async function writeEntries(entries, { verify = true } = {}) {
    if (entries.length === 0) return {};

    const results = {};
    await withProgrammingMode(async () => {
      for (const entry of entries) {
        results[entry.key] = await sendCmd(`${entry.command}=${entry.value}`, true);
      }
    });
    notifyWrite({ commands: entries.map((entry) => entry.command) });

    if (verify) {
      for (const entry of entries) {
        if (!entry.label || !entry.suffix) continue;
        try {
          const stored = String((await readCmd(`${entry.base}*${entry.suffix}`)) ?? '').trim();
          results[`${entry.key}ReadBack`] = stored;
          results[`${entry.key}Verified`] = stored === String(entry.value).trim();
        } catch (error) {
          results[`${entry.key}Verified`] = null;
        }
      }
    }
    return results;
  }

  return {
    addWriteListener,
    notifyWrite,
    sendCmd,
    readCmd,
    safeReadCmd,
    batchRead,
    safeBatchRead,
    batchReadOrFallback,
    sequential,
    withProgrammingMode,
    writeCmd,
    buildWriteEntries,
    writeEntries,
    stats: () => ({ ...stats, batchUnsupported: [...batchUnsupported] }),
  };
}

module.exports = {
  CommandError,
  DEFAULT_RETRIES,
  LABEL_MAX,
  createCommandLayer,
  describeCommand,
  isLabelCommand,
  normalizeWriteValue,
  validateLabel,
};
