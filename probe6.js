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
  console.log('=== PROBING Z2W (2-WAY WIRELESS) COMMANDS ===\n');

  const tcp = panel.RiscoComm.TCPSocket;

  // Enter prog mode
  await tcp.SendCommand('PROG=1', true);

  // All Z2W commands found in CS.exe
  const z2wCmds = [
    'Z2WPRSNS',   // PIR Sensitivity
    'Z2WSKSNS',   // Shock Sensitivity
    'Z2WMWSNS',   // Microwave Sensitivity
    'Z2WENLED',   // Enable LED
    'Z2WENVB',    // Enable Vibration
    'Z2WENSAB',   // Enable Sabotage
    'Z2WHOLD',    // Hold time
    'Z2WPLSCN',   // Pulse count
    'Z2WRSPTM',   // Response time
    'Z2WENAM',    // Enable AM
    'Z2WSMOPM',   // Smoke operation mode
    'Z2WALKTS',   // Walk test
    'Z2WRSWEN',   // RS WEN
  ];

  // Also all other zone commands from CS.exe we haven't tried
  const otherCmds = [
    'ZABORT', 'ZALOC', 'ZBYPAS', 'ZCHIMES', 'ZCONF',
    'ZCRC', 'ZFORCE', 'ZIN1TERM', 'ZIN2TERM', 'ZLBL',
    'ZNACTV', 'ZNEN', 'ZNGLBL', 'ZNOTI', 'ZNOTILOG',
    'ZNREP', 'ZNSHINPR', 'ZNVER', 'ZONEDESC', 'ZPART',
    'ZRRI', 'ZRSSI', 'ZRSSITIM', 'ZSN', 'ZSOUND',
    'ZSTT', 'ZTST', 'ZTYPE',
    // Also non-zone commands that might be relevant
    'SWINGER', 'DSSRLVL', 'DSSRN', 'DSSRER',
  ];

  // Test Z2W commands on zones 9 and 24 (our PIR sensors)
  console.log('--- Z2W commands on Zone 9 (דלת כניסה) and Zone 24 (מטבח פנימי) ---\n');

  for (const cmd of z2wCmds) {
    for (const zone of [9, 24]) {
      // Try multiple formats
      for (const fmt of [`${cmd}${zone}?`, `${cmd}*${zone}?`]) {
        try {
          const r = await tcp.SendCommand(fmt, true);
          if (r && !r.startsWith('N')) {
            console.log(`  *** HIT *** ${fmt.padEnd(22)} => ${r}`);
          }
        } catch(e) {}
      }
    }
  }

  // Test other zone commands we found in CS.exe
  console.log('\n--- Other CS.exe zone commands on Zone 9 ---\n');

  for (const cmd of otherCmds) {
    for (const fmt of [`${cmd}${9}?`, `${cmd}*${9}?`]) {
      try {
        const r = await tcp.SendCommand(fmt, true);
        if (r && !r.startsWith('N')) {
          console.log(`  *** HIT *** ${fmt.padEnd(22)} => ${r}`);
        }
      } catch(e) {}
    }
  }

  // Try # notation (wildcard for all zones)
  console.log('\n--- Wildcard # queries ---\n');
  for (const cmd of z2wCmds) {
    try {
      const r = await tcp.SendCommand(`${cmd}#?`, true);
      if (r && !r.startsWith('N')) {
        console.log(`  *** HIT *** ${cmd}#?  => ${r}`);
      }
    } catch(e) {}
  }

  // Exit prog mode
  try { await tcp.SendCommand('PROG=2', true); } catch(e) {}

  console.log('\n=== PROBE COMPLETE ===');
  process.exit(0);
});

panel.on('PanelCommError', (err) => {
  console.error('Panel error:', err);
});
