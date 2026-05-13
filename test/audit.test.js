const assert = require('node:assert/strict');
const test = require('node:test');

const { assessAuditSnapshot, isDefaultNumberedLabel, sameSubnet } = require('../src/audit');

function codes(report) {
  return report.findings.map((finding) => finding.code);
}

function sampleSnapshot(overrides = {}) {
  return {
    generatedAt: '2026-05-10T19:00:00.000Z',
    panel: { model: 'RP432', version: 'test' },
    system: { sstt: '--------------F--------', batteryVoltage: 13.8 },
    gsm: {
      health: {
        usable: false,
        severity: 'issue',
        summary: 'SIM present, not registered, GPRS not attached, very weak',
        signal: { rssi: 2, dbm: -109 },
      },
    },
    access: {
      remoteAccess: { enabled: true, remoteId: '0001', codeInfo: { present: true, length: 6, weak: false } },
      installerPinInfo: { present: true, length: 4, weak: false },
      subInstallerPinInfo: { present: true, length: 4, weak: true },
    },
    users: [
      { id: 1, label: 'YOGEV', pinInfo: { present: true, length: 4, weak: false } },
      { id: 6, label: '06 User', pinInfo: { present: true, length: 4, weak: true } },
      { id: 7, label: '7 User', pinInfo: { present: true, length: 4, weak: true } },
    ],
    zones: [
      {
        id: 23,
        label: 'Storage',
        type: 5,
        tech: 'W',
        rssi: 31,
        lastCheckIn: '10/05/2026 22:43',
        lastTrigger: '10/05/2026 22:43',
        status: {},
      },
      {
        id: 26,
        label: '26 Zone',
        type: 0,
        tech: 'W',
        rssi: 0,
        lastCheckIn: '00/00/0000 00:00',
        lastTrigger: '11/04/2022 21:02',
        status: { notUsed: true },
      },
    ],
    cloud: {
      enabled: true,
      encrypted: false,
      armEnabled: true,
      disarmEnabled: true,
      passwordInfo: { present: true, length: 6, weak: false },
    },
    network: {
      ip: '192.168.070.101',
      subnet: '255.255.255.000',
      gateway: '192.168.040.001',
    },
    ...overrides,
  };
}

test('assessAuditSnapshot returns grouped open issues without exposing secrets', () => {
  const report = assessAuditSnapshot(sampleSnapshot(), { now: new Date('2026-05-10T20:00:00.000Z') });

  assert.equal(report.summary.openCount, 7);
  assert.equal(report.summary.watchCount, 3);
  assert.deepEqual(codes(report).filter((code) => code !== 'remote_access_enabled' && code !== 'cloud_remote_control_enabled'), [
    'sub_installer_pin_weak',
    'gsm_unusable',
    'weak_user_pins',
    'cloud_encryption_disabled',
    'gateway_outside_subnet',
    'default_user_labels',
    'orphan_zone_config',
    'watch_wireless_signal',
  ]);
  assert.equal(JSON.stringify(report).includes('2222'), false);
});

test('bell switch flag is not treated as siren trouble', () => {
  const report = assessAuditSnapshot(sampleSnapshot({
    system: { sstt: '--------------F--------', batteryVoltage: 13.8 },
    gsm: { health: { usable: true } },
    access: {
      remoteAccess: { enabled: false, remoteId: '0001', codeInfo: { present: true, length: 6, weak: false } },
      installerPinInfo: { present: true, length: 4, weak: false },
      subInstallerPinInfo: { present: true, length: 4, weak: false },
    },
    users: [],
    zones: [],
    cloud: { enabled: false },
    network: { ip: '192.168.070.101', subnet: '255.255.255.000', gateway: '192.168.070.001' },
  }));

  assert.equal(codes(report).includes('system_bell_trouble'), false);
  assert.equal(codes(report).includes('system_bell_tamper'), false);
});

test('bell trouble and tamper flags are reported', () => {
  const report = assessAuditSnapshot(sampleSnapshot({
    system: { sstt: 'EY', batteryVoltage: 13.8 },
    gsm: { health: { usable: true } },
    access: {
      remoteAccess: { enabled: false, remoteId: '0001', codeInfo: { present: true, length: 6, weak: false } },
      installerPinInfo: { present: true, length: 4, weak: false },
      subInstallerPinInfo: { present: true, length: 4, weak: false },
    },
    users: [],
    zones: [],
    cloud: { enabled: false },
    network: { ip: '192.168.070.101', subnet: '255.255.255.000', gateway: '192.168.070.001' },
  }));

  assert.equal(codes(report).includes('system_bell_trouble'), true);
  assert.equal(codes(report).includes('system_bell_tamper'), true);
});

test('weak remote access code is critical', () => {
  const report = assessAuditSnapshot(sampleSnapshot({
    access: {
      remoteAccess: { enabled: true, remoteId: '0001', codeInfo: { present: true, length: 4, weak: true } },
    },
  }));

  const finding = report.findings.find((item) => item.code === 'remote_access_code_weak');
  assert.equal(finding.severity, 'critical');
  assert.equal(report.summary.highestSeverity, 'critical');
});

test('default numbered labels and IPv4 subnets handle padded panel values', () => {
  assert.equal(isDefaultNumberedLabel('06 User', 6), true);
  assert.equal(isDefaultNumberedLabel('03 אזור', 3), true);
  assert.equal(isDefaultNumberedLabel('2 קבוצה', 2), true);
  assert.equal(isDefaultNumberedLabel('YOGEV', 1), false);
  assert.equal(sameSubnet('192.168.070.101', '192.168.070.001', '255.255.255.000'), true);
  assert.equal(sameSubnet('192.168.070.101', '192.168.040.001', '255.255.255.000'), false);
});
