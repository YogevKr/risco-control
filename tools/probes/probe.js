const RiscoTCPPanel = require('risco-lan-bridge');

const Options = {
  Panel_IP: process.env.RISCO_IP || '127.0.0.1',
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
  console.log('=== PANEL CONNECTED - STARTING PROBE ===\n');

  const tcp = panel.RiscoComm.TCPSocket;

  // Zone 9 = דלת כניסה
  const ZONE = 9;

  // Known working commands for reference
  const knownCmds = [
    `ZTYPE*${ZONE}?`,
    `ZLBL*${ZONE}?`,
    `ZSTT*${ZONE}?`,
    `ZPART&*${ZONE}?`,
    `ZAREA&*${ZONE}?`,
    `ZLNKTYP${ZONE}?`,
  ];

  // Candidate commands to probe for zone config
  const probeCmds = [
    // Zone parameters / sensitivity
    `ZPARAM*${ZONE}?`,
    `ZPARAM${ZONE}?`,
    `ZPAR*${ZONE}?`,
    `ZPAR${ZONE}?`,
    `ZSENS*${ZONE}?`,
    `ZSENS${ZONE}?`,
    `ZCONF*${ZONE}?`,
    `ZCONF${ZONE}?`,
    `ZCFG*${ZONE}?`,
    `ZCFG${ZONE}?`,
    `ZSET*${ZONE}?`,
    `ZSET${ZONE}?`,
    `ZWCFG*${ZONE}?`,
    `ZWCFG${ZONE}?`,
    `ZWPAR*${ZONE}?`,
    `ZWPAR${ZONE}?`,
    `ZSPD*${ZONE}?`,
    `ZSPD${ZONE}?`,
    `ZDEL*${ZONE}?`,
    `ZDEL${ZONE}?`,
    `ZATTR*${ZONE}?`,
    `ZATTR${ZONE}?`,
    `ZOPT*${ZONE}?`,
    `ZOPT${ZONE}?`,
    `ZOPTS*${ZONE}?`,
    `ZOPTS${ZONE}?`,
    `ZMODE*${ZONE}?`,
    `ZMODE${ZONE}?`,
    `ZSWGR*${ZONE}?`,
    `ZSWGR${ZONE}?`,
    `ZWZONE*${ZONE}?`,
    `ZWZONE${ZONE}?`,
    // Wireless-specific
    `ZWSENS*${ZONE}?`,
    `ZWSENS${ZONE}?`,
    `ZWID*${ZONE}?`,
    `ZWID${ZONE}?`,
    `ZRSSI*${ZONE}?`,
    `ZRSSI${ZONE}?`,
    // PIR / detector
    `ZPIR*${ZONE}?`,
    `ZPIR${ZONE}?`,
    `ZDET*${ZONE}?`,
    `ZDET${ZONE}?`,
    // Tamper / supervision
    `ZTAMP*${ZONE}?`,
    `ZTAMP${ZONE}?`,
    `ZSUP*${ZONE}?`,
    `ZSUP${ZONE}?`,
    // Timing
    `ZTIME*${ZONE}?`,
    `ZTIME${ZONE}?`,
    `ZENTDEL*${ZONE}?`,
    `ZENTDEL${ZONE}?`,
    `ZEXDEL*${ZONE}?`,
    `ZEXDEL${ZONE}?`,
    // Chime / alarm
    `ZCHIM*${ZONE}?`,
    `ZCHIM${ZONE}?`,
    `ZALRM*${ZONE}?`,
    `ZALRM${ZONE}?`,
    // Zone description / extra info
    `ZDSC*${ZONE}?`,
    `ZDSC${ZONE}?`,
    `ZINFO*${ZONE}?`,
    `ZINFO${ZONE}?`,
    `ZDATA*${ZONE}?`,
    `ZDATA${ZONE}?`,
    // Try range queries
    `ZPARAM*${ZONE}:${ZONE}?`,
    `ZSENS*${ZONE}:${ZONE}?`,
    `ZCONF*${ZONE}:${ZONE}?`,
    // General system commands that might reveal features
    `HELP?`,
    `HELP`,
    `CMD?`,
    `CMDS?`,
    `VER?`,
    `PNLCAP?`,
    `PNLCFG?`,
    `CONFIG?`,
  ];

  console.log('--- Known working commands ---');
  for (const cmd of knownCmds) {
    try {
      const result = await tcp.SendCommand(cmd);
      console.log(`  ${cmd.padEnd(20)} => ${result}`);
    } catch (e) {
      console.log(`  ${cmd.padEnd(20)} => ERROR: ${e.message}`);
    }
  }

  console.log('\n--- Probing unknown commands ---');
  for (const cmd of probeCmds) {
    try {
      const result = await tcp.SendCommand(cmd);
      if (result && !result.startsWith('N') && result !== 'ACK') {
        console.log(`  *** HIT *** ${cmd.padEnd(25)} => ${result}`);
      } else if (result === 'ACK') {
        console.log(`  [ACK]      ${cmd.padEnd(25)} => ACK`);
      } else {
        console.log(`  [err]      ${cmd.padEnd(25)} => ${result}`);
      }
    } catch (e) {
      console.log(`  [exc]      ${cmd.padEnd(25)} => ${e.message}`);
    }
  }

  console.log('\n=== PROBE COMPLETE ===');
  process.exit(0);
});

panel.on('PanelCommError', (err) => {
  console.error('Panel error:', err);
});
