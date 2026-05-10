const assert = require('node:assert/strict');
const test = require('node:test');

const { assessGsmHealth, decodeGsmStatus, parseGsmSignal } = require('../src/gsm-health');

test('decodeGsmStatus treats --Q----- as SIM present but not registered or attached', () => {
  assert.deepEqual(decodeGsmStatus('--Q-----'), {
    raw: '--Q-----',
    registered: false,
    gprsAttached: false,
    simInserted: true,
    networkAvail: false,
  });
});

test('parseGsmSignal converts CSQ RSSI to dBm and quality', () => {
  assert.deepEqual(parseGsmSignal('2'), {
    rssi: 2,
    dbm: -109,
    bars: 1,
    quality: 'Very weak',
  });
});

test('assessGsmHealth marks weak unregistered GSM as unusable', () => {
  const health = assessGsmHealth('--Q-----', '2');

  assert.equal(health.usable, false);
  assert.equal(health.severity, 'issue');
  assert.equal(health.statusFlags.simInserted, true);
  assert.equal(health.statusFlags.registered, false);
  assert.equal(health.statusFlags.gprsAttached, false);
  assert.equal(health.signal.rssi, 2);
  assert.match(health.summary, /SIM present/);
  assert.match(health.summary, /not registered/);
  assert.match(health.summary, /GPRS not attached/);
  assert.deepEqual(
    health.findings.map((finding) => finding.code),
    ['not_registered', 'not_attached', 'very_weak_signal']
  );
});
