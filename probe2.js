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
  console.log('=== DEEP PROBE - ZONE CONFIG & RSSI ===\n');

  const tcp = panel.RiscoComm.TCPSocket;

  // We found: ZCONF9=0, ZRSSI9=44
  // Let's explore these more and find related commands

  console.log('--- ZCONF for all active zones ---');
  for (let z = 1; z <= 29; z++) {
    try {
      const result = await tcp.SendCommand(`ZCONF${z}?`);
      const rssi = await tcp.SendCommand(`ZRSSI${z}?`);
      console.log(`  Zone ${String(z).padStart(2)}: ZCONF=${result.split('=')[1] || result}  RSSI=${rssi.split('=')[1] || rssi}`);
    } catch (e) {
      console.log(`  Zone ${String(z).padStart(2)}: error`);
    }
  }

  console.log('\n--- Explore ZCONF value space (try setting different values on zone 9) ---');
  // First, read range of ZCONF queries
  const confVariations = [
    'ZCONF*1:8?',
    'ZCONF&*9?',
    'ZCONF&9?',
  ];
  for (const cmd of confVariations) {
    try {
      const result = await tcp.SendCommand(cmd);
      console.log(`  ${cmd.padEnd(20)} => ${result}`);
    } catch (e) {
      console.log(`  ${cmd.padEnd(20)} => ${e.message}`);
    }
  }

  // Probe more "Z" prefixed commands systematically
  console.log('\n--- Systematic Z-command probe (zone 9) ---');
  const prefixes = [
    'ZA', 'ZB', 'ZC', 'ZD', 'ZE', 'ZF', 'ZG', 'ZH', 'ZI', 'ZJ', 'ZK', 'ZL',
    'ZM', 'ZN', 'ZO', 'ZP', 'ZQ', 'ZR', 'ZS', 'ZT', 'ZU', 'ZV', 'ZW', 'ZX', 'ZY', 'ZZ'
  ];

  for (const pfx of prefixes) {
    // Try 2, 3, and 4 letter commands
    const suffixes = ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
    for (const sfx of suffixes) {
      const cmd = `${pfx}${sfx}9?`;
      try {
        const result = await tcp.SendCommand(cmd);
        if (result && !result.startsWith('N')) {
          console.log(`  *** HIT *** ${cmd.padEnd(15)} => ${result}`);
        }
      } catch (e) {
        // skip
      }
    }
  }

  // Also probe non-Z system commands for config capabilities
  console.log('\n--- System/global config probe ---');
  const sysCmds = [
    'SENSITIVITY?', 'SENS?', 'DETECT?', 'THRESH?',
    'PIRCFG?', 'PIRSENS?',
    'SWVER?', 'HWVER?', 'PANELID?',
    'SYSINFO?', 'SYSCFG?', 'SYSCNF?',
    'DEVLST?', 'DEVLIST?',
    'NETLST?', 'NETCFG?',
    'WZCFG?', 'WLCFG?', 'RFCFG?',
    'PROG?',
    'ENTDEL?', 'EXDEL?',
    'ALRMCFG?',
    'SIRENTIME?', 'BELLTIME?',
    'USRLST?', 'USRLIST?',
    'EVTLOG?', 'EVENTS?',
    'CLOCK?',
  ];

  for (const cmd of sysCmds) {
    try {
      const result = await tcp.SendCommand(cmd);
      if (result && !result.startsWith('N')) {
        console.log(`  *** HIT *** ${cmd.padEnd(20)} => ${result}`);
      }
    } catch (e) {
      // skip
    }
  }

  console.log('\n=== DEEP PROBE COMPLETE ===');
  process.exit(0);
});

panel.on('PanelCommError', (err) => {
  console.error('Panel error:', err);
});
