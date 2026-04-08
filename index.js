const RiscoTCPPanel = require('risco-lan-bridge');

// ============================================
// CONFIGURE THESE FOR YOUR PANEL
// ============================================
const Options = {
  Panel_IP: process.env.RISCO_IP || '192.168.40.199',
  Panel_Port: parseInt(process.env.RISCO_PORT) || 1000,
  Panel_Password: parseInt(process.env.RISCO_PASSWORD) || 5678,
  Panel_Id: process.env.RISCO_PANEL_ID || '0001',
  AutoDiscover: true,
  DiscoverCode: true,
  AutoConnect: true,
  SocketMode: 'direct',
  log: console,
};

// Change this to match your panel type:
// Agility, WiComm, WiCommPro, LightSys, ProsysPlus, GTPlus
const PANEL_TYPE = process.env.RISCO_PANEL_TYPE || 'LightSys';

console.log(`Connecting to Risco ${PANEL_TYPE} at ${Options.Panel_IP}:${Options.Panel_Port}...`);

const panel = new RiscoTCPPanel[PANEL_TYPE](Options);

panel.on('SystemInitComplete', () => {
  console.log('\n========================================');
  console.log('  SYSTEM CONNECTED & INITIALIZED');
  console.log('========================================\n');

  // --- Print all zones with their status ---
  printAllZones(panel);

  // --- Print system status ---
  printSystemStatus(panel);

  // --- Print partition status ---
  printPartitions(panel);

  // --- Listen for real-time events ---
  setupZoneListeners(panel);
  setupSystemListeners(panel);
  setupPartitionListeners(panel);

  console.log('\nListening for real-time events... (Ctrl+C to quit)\n');
});

panel.on('PanelCommError', (err) => {
  console.error('[ERROR] Panel communication error:', err);
});

// ============================================
// Print all zones and their current status
// ============================================
function printAllZones(panel) {
  console.log('--- ZONES ---');
  console.log(
    'ID'.padStart(4),
    'Label'.padEnd(25),
    'Type'.padEnd(16),
    'Tech'.padEnd(10),
    'Open'.padEnd(6),
    'Battery'.padEnd(10),
    'Tamper'.padEnd(8),
    'Trouble'.padEnd(9),
    'Bypass'.padEnd(8),
    'Lost'.padEnd(6)
  );
  console.log('-'.repeat(110));

  panel.Zones.forEach((zone) => {
    if (zone.NotUsed) return;
    console.log(
      String(zone.Id).padStart(4),
      (zone.Label || `Zone ${zone.Id}`).padEnd(25),
      (zone.TypeStr || String(zone.Type)).padEnd(16),
      (zone.Techno || '').padEnd(10),
      (zone.Open ? 'OPEN' : 'closed').padEnd(6),
      (zone.LowBattery ? 'LOW !!!' : 'OK').padEnd(10),
      (zone.Tamper ? 'TAMPER' : 'ok').padEnd(8),
      (zone.Trouble ? 'TROUBLE' : 'ok').padEnd(9),
      (zone.Bypass ? 'YES' : 'no').padEnd(8),
      (zone.Lost ? 'LOST' : 'ok').padEnd(6)
    );
  });
  console.log('');
}

// ============================================
// Print system status
// ============================================
function printSystemStatus(panel) {
  const sys = panel.MBSystem;
  console.log('--- SYSTEM STATUS ---');
  console.log(`  Panel Battery:   ${sys.LowBattery ? 'LOW !!!' : 'OK'}`);
  console.log(`  AC Power:        ${sys.ACUnplugged ? 'UNPLUGGED !!!' : 'OK'}`);
  console.log(`  Phone Line:      ${sys.PhoneLineTrouble ? 'TROUBLE' : 'OK'}`);
  console.log(`  Box Tamper:      ${sys.BoxTamperOpen ? 'OPEN !!!' : 'Closed'}`);
  console.log(`  Bell:            ${sys.BellTrouble ? 'TROUBLE' : 'OK'}`);
  console.log(`  Bell Tamper:     ${sys.BellTamper ? 'TAMPER' : 'OK'}`);
  console.log(`  Jamming:         ${sys.JammingTrouble ? 'TROUBLE' : 'OK'}`);
  console.log(`  RS485 Bus:       ${sys.Rs485BusTrouble ? 'TROUBLE' : 'OK'}`);
  console.log('');
}

// ============================================
// Print partitions
// ============================================
function printPartitions(panel) {
  console.log('--- PARTITIONS ---');
  panel.Partitions.forEach((part) => {
    if (!part.Exist) return;
    const status = part.Arm ? (part.HomeStay ? 'ARMED HOME' : 'ARMED AWAY') : 'DISARMED';
    console.log(`  Partition ${part.Id}: ${status}${part.Alarm ? ' [ALARM!]' : ''}`);
  });
  console.log('');
}

// ============================================
// Real-time zone event listeners
// ============================================
function setupZoneListeners(panel) {
  panel.Zones.on('ZStatusChanged', (id, event) => {
    const zone = panel.Zones.ById(id);
    const label = zone ? (zone.Label || `Zone ${id}`) : `Zone ${id}`;
    const ts = new Date().toLocaleTimeString();

    switch (event) {
      case 'Open':
      case 'Closed':
        console.log(`[${ts}] ZONE ${label} (${id}): ${event}`);
        break;
      case 'LowBattery':
        console.log(`[${ts}] BATTERY LOW: ${label} (${id})`);
        break;
      case 'BatteryOk':
        console.log(`[${ts}] Battery OK: ${label} (${id})`);
        break;
      case 'Tamper':
      case 'Hold':
        console.log(`[${ts}] TAMPER ${label} (${id}): ${event}`);
        break;
      case 'Alarm':
      case 'StandBy':
        console.log(`[${ts}] ALARM ${label} (${id}): ${event}`);
        break;
      case 'Trouble':
      case 'Sureness':
        console.log(`[${ts}] TROUBLE ${label} (${id}): ${event}`);
        break;
      case 'Lost':
      case 'Located':
        console.log(`[${ts}] COMM ${label} (${id}): ${event}`);
        break;
      default:
        console.log(`[${ts}] ${label} (${id}): ${event}`);
    }
  });
}

// ============================================
// Real-time system event listeners
// ============================================
function setupSystemListeners(panel) {
  const sys = panel.MBSystem;

  sys.on('LowBattery', () => console.log(`[${ts()}] SYSTEM: Panel Battery LOW`));
  sys.on('BatteryOk', () => console.log(`[${ts()}] SYSTEM: Panel Battery OK`));
  sys.on('ACUnplugged', () => console.log(`[${ts()}] SYSTEM: AC Power LOST`));
  sys.on('ACPlugged', () => console.log(`[${ts()}] SYSTEM: AC Power Restored`));
  sys.on('BoxTamperOpen', () => console.log(`[${ts()}] SYSTEM: Box Tamper OPEN`));
  sys.on('BoxTamperClosed', () => console.log(`[${ts()}] SYSTEM: Box Tamper Closed`));
  sys.on('BellTrouble', () => console.log(`[${ts()}] SYSTEM: Bell Trouble`));
  sys.on('BellOk', () => console.log(`[${ts()}] SYSTEM: Bell OK`));
  sys.on('JammingTrouble', () => console.log(`[${ts()}] SYSTEM: RF Jamming Detected`));
  sys.on('JammingOk', () => console.log(`[${ts()}] SYSTEM: RF Jamming Cleared`));
}

// ============================================
// Real-time partition event listeners
// ============================================
function setupPartitionListeners(panel) {
  panel.Partitions.on('PStatusChanged', (id, event) => {
    console.log(`[${ts()}] PARTITION ${id}: ${event}`);
  });
}

function ts() {
  return new Date().toLocaleTimeString();
}
