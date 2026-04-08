const RiscoTCPPanel = require('risco-lan-bridge');

const Options = {
  Panel_IP: '192.168.40.199',
  Panel_Port: 1000,
  Panel_Password: 5678,
  Panel_Id: '0001',
  AutoDiscover: true,
  DiscoverCode: true,
  AutoConnect: true,
  SocketMode: 'direct',
};

const panel = new RiscoTCPPanel.LightSys(Options);

panel.on('SystemInitComplete', async () => {
  console.log('=== DEEP PROTOCOL PROBE - MEMORY & PARAMETER ACCESS ===\n');

  const tcp = panel.RiscoComm.TCPSocket;
  const ZONE = 9;

  // Enter prog mode
  console.log('Entering programming mode...');
  await tcp.SendCommand('PROG=1', true);

  // Approach 1: Parameter number access (common in alarm panels)
  // Format: P<number>? or PAR<number>? or PARAM<number>?
  console.log('\n--- Parameter number access ---');
  const paramFormats = [
    // Direct parameter numbers (zone 9 params might be at offset like 9*N)
    ...Array.from({length: 50}, (_, i) => `P${i}?`),
    // Try with zone offset
    ...Array.from({length: 20}, (_, i) => `P${900 + i}?`),
    ...Array.from({length: 20}, (_, i) => `P${90 + i}?`),
    ...Array.from({length: 20}, (_, i) => `P${9000 + i}?`),
  ];

  for (const cmd of paramFormats) {
    try {
      const r = await tcp.SendCommand(cmd, true);
      if (r && !r.startsWith('N')) {
        console.log(`  *** HIT *** ${cmd.padEnd(15)} => ${r}`);
      }
    } catch(e) {}
  }

  // Approach 2: Memory/register read
  console.log('\n--- Memory read commands ---');
  const memCmds = [
    'RMEM0?', 'RMEM1?', 'RMEM100?', 'RMEM200?',
    'MEM0?', 'MEM1?', 'MEM100?',
    'REG0?', 'REG1?', 'REG100?',
    'READ0?', 'READ1?',
    'RD0?', 'RD1?',
    'GET0?', 'GET1?',
    'DUMP0?', 'DUMP1?',
    'BLK0?', 'BLK1?',
    'DAT0?', 'DAT1?',
  ];

  for (const cmd of memCmds) {
    try {
      const r = await tcp.SendCommand(cmd, true);
      if (r && !r.startsWith('N')) {
        console.log(`  *** HIT *** ${cmd.padEnd(15)} => ${r}`);
      }
    } catch(e) {}
  }

  // Approach 3: CS.exe might use totally different command prefix letters
  // We tried Z* exhaustively, but what about other prefixes for zone config?
  console.log('\n--- Non-Z zone config commands ---');
  const altCmds = [
    // Detector / sensor commands
    `DET${ZONE}?`, `DTC${ZONE}?`, `DTR${ZONE}?`,
    `SEN${ZONE}?`, `SNS${ZONE}?`, `SENS${ZONE}?`,
    `PIR${ZONE}?`, `PIRC${ZONE}?`, `PIRM${ZONE}?`, `PIRS${ZONE}?`,
    `MOT${ZONE}?`, `MOTN${ZONE}?`,
    // Config / parameter
    `CFG${ZONE}?`, `CNF${ZONE}?`, `CONF${ZONE}?`,
    `SET${ZONE}?`, `PAR${ZONE}?`, `PRM${ZONE}?`,
    `OPT${ZONE}?`, `FLG${ZONE}?`, `FLAG${ZONE}?`,
    // Wireless detector config
    `WDT${ZONE}?`, `WCF${ZONE}?`, `WSN${ZONE}?`, `WST${ZONE}?`,
    `WZN${ZONE}?`, `WZC${ZONE}?`,
    `RFZ${ZONE}?`, `RFC${ZONE}?`, `RFS${ZONE}?`,
    // Threshold
    `THR${ZONE}?`, `THS${ZONE}?`, `TRH${ZONE}?`,
    `LVL${ZONE}?`, `LEV${ZONE}?`,
    // iWave / detector model specific
    `IWV${ZONE}?`, `IWC${ZONE}?`,
    `DGT${ZONE}?`, `DMD${ZONE}?`,
  ];

  for (const cmd of altCmds) {
    try {
      const r = await tcp.SendCommand(cmd, true);
      if (r && !r.startsWith('N')) {
        console.log(`  *** HIT *** ${cmd.padEnd(15)} => ${r}`);
      }
    } catch(e) {}
  }

  // Approach 4: Commands with = sign (write format) used as query
  // Some panels respond to COMMAND=ZONE,? or COMMAND=ZONE?
  console.log('\n--- Alternative query formats ---');
  const altFormats = [
    `ZCONF=${ZONE}?`, `ZCONF=${ZONE},?`,
    `ZSENS=${ZONE}?`, `ZSENS=${ZONE},?`,
    `ZPIR=${ZONE}?`, `ZPIR=${ZONE},?`,
    `ZDET=${ZONE}?`, `ZDET=${ZONE},?`,
    `ZCFG=${ZONE}?`, `ZCFG=${ZONE},?`,
    `ZPAR=${ZONE}?`, `ZPAR=${ZONE},?`,
    // Try indexed sub-parameter access: ZCONF9.1? ZCONF9.2? etc
    `ZCONF${ZONE}.0?`, `ZCONF${ZONE}.1?`, `ZCONF${ZONE}.2?`, `ZCONF${ZONE}.3?`,
    // Try bracket notation
    `ZCONF[${ZONE}]?`, `ZPARAM[${ZONE}]?`,
    // Try with # prefix
    `Z#${ZONE}?`, `ZC#${ZONE}?`,
    // Try comma-separated zone,param
    `ZONE=${ZONE},0?`, `ZONE=${ZONE},1?`, `ZONE=${ZONE},2?`,
    `ZONE=${ZONE}?`, `ZONE${ZONE}?`,
    // Try EEPROM/flash read (CS.exe likely reads config memory)
    'EEPROM?', 'FLASH?', 'NVRAM?', 'SRAM?',
    'EE0?', 'FL0?', 'NV0?',
  ];

  for (const cmd of altFormats) {
    try {
      const r = await tcp.SendCommand(cmd, true);
      if (r && !r.startsWith('N')) {
        console.log(`  *** HIT *** ${cmd.padEnd(20)} => ${r}`);
      }
    } catch(e) {}
  }

  // Approach 5: Full 2-letter brute force (not just Z prefix)
  // Try all two-letter combinations followed by zone number
  console.log('\n--- Full 2-letter brute force (all prefixes, zone 9) ---');
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < alpha.length; i++) {
    for (let j = 0; j < alpha.length; j++) {
      const pfx = `${alpha[i]}${alpha[j]}`;
      if (pfx.startsWith('Z')) continue; // already done
      const cmd = `${pfx}${ZONE}?`;
      try {
        const r = await tcp.SendCommand(cmd, true);
        if (r && !r.startsWith('N') && r !== 'ACK') {
          console.log(`  *** HIT *** ${cmd.padEnd(12)} => ${r}`);
        }
      } catch(e) {}
    }
  }

  // Exit prog mode
  console.log('\nExiting prog mode...');
  try { await tcp.SendCommand('PROG=2', true); } catch(e) {}

  console.log('\n=== PROBE COMPLETE ===');
  process.exit(0);
});

panel.on('PanelCommError', (err) => {
  console.error('Panel error:', err);
});
