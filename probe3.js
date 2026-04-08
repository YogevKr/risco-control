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
  console.log('=== PROG MODE PROBE ===\n');

  const tcp = panel.RiscoComm.TCPSocket;
  const ZONE = 9;

  // Enter programming mode
  console.log('Entering programming mode...');
  try {
    const progResult = await tcp.SendCommand('PROG=1', true);
    console.log(`PROG=1 => ${progResult}`);
  } catch (e) {
    console.log(`PROG=1 failed: ${e.message}`);
  }

  // Now try zone config commands in prog mode
  console.log('\n--- Zone config commands in PROG mode ---');
  const progCmds = [
    // Try different zone parameter commands
    `ZCONF*${ZONE}?`,
    `ZCONF${ZONE}?`,
    `ZPARAM*${ZONE}?`,
    `ZPARAM${ZONE}?`,
    `ZSENS${ZONE}?`,
    `ZWCFG${ZONE}?`,
    // Risco CS.exe likely uses numbered parameter access
    // Format might be like ZONE<param_id>=<zone_id>,<value>
    `ZCNF${ZONE}?`,
    `ZFLAG${ZONE}?`,
    `ZFLG${ZONE}?`,
    // Try reading zone config as a block
    `ZCFG${ZONE}?`,
    `ZPRG${ZONE}?`,
    `ZPGM${ZONE}?`,
    // Risco panels often use numbered parameters: P<number>=value
    // Zone programming parameters
    `ZP1*${ZONE}?`,
    `ZP2*${ZONE}?`,
    `ZP3*${ZONE}?`,
    `ZP4*${ZONE}?`,
    `ZP5*${ZONE}?`,
    `ZP1${ZONE}?`,
    `ZP2${ZONE}?`,
    `ZP3${ZONE}?`,
    // Full zone dump
    `ZALL${ZONE}?`,
    `ZFULL${ZONE}?`,
    `ZDUMP${ZONE}?`,
    // Detector parameters
    `ZDET${ZONE}?`,
    `ZDTC${ZONE}?`,
    // Wireless specific
    `ZWS${ZONE}?`,
    `ZWC${ZONE}?`,
    `ZWT${ZONE}?`,
    `ZWP${ZONE}?`,
    `ZWR${ZONE}?`,
    `ZWID${ZONE}?`,
    `ZWSN${ZONE}?`,
    `ZWSER${ZONE}?`,
    // Entry/exit delay
    `ZEDLY${ZONE}?`,
    `ZEDL${ZONE}?`,
    `ZXDL${ZONE}?`,
    // Alarm response
    `ZRESP${ZONE}?`,
    `ZRSP${ZONE}?`,
    // Speed / timing
    `ZSPD${ZONE}?`,
    `ZTIM${ZONE}?`,
    // Cross zone
    `ZXZ${ZONE}?`,
    `ZCRZ${ZONE}?`,
    // Swinger / count
    `ZSWG${ZONE}?`,
    `ZCNT${ZONE}?`,
    // Chime
    `ZCHM${ZONE}?`,
    // Try reading config memory directly
    `MEM?`,
    `RMEM?`,
  ];

  for (const cmd of progCmds) {
    try {
      const result = await tcp.SendCommand(cmd, true);
      if (result && !result.startsWith('N')) {
        console.log(`  *** HIT *** ${cmd.padEnd(20)} => ${result}`);
      }
    } catch (e) {
      // skip
    }
  }

  // Try brute-force 2-char prefix + zone id
  console.log('\n--- Brute force 2-char cmds with zone 9 ---');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < chars.length; i++) {
    for (let j = 0; j < chars.length; j++) {
      const cmd = `${chars[i]}${chars[j]}${ZONE}?`;
      try {
        const result = await tcp.SendCommand(cmd, true);
        if (result && !result.startsWith('N')) {
          console.log(`  *** HIT *** ${cmd.padEnd(12)} => ${result}`);
        }
      } catch (e) {
        // skip
      }
    }
  }

  // Exit programming mode
  console.log('\nExiting programming mode...');
  try {
    const exitResult = await tcp.SendCommand('PROG=2', true);
    console.log(`PROG=2 => ${exitResult}`);
  } catch (e) {
    console.log(`PROG=2 failed: ${e.message}`);
  }

  console.log('\n=== PROBE COMPLETE ===');
  process.exit(0);
});

panel.on('PanelCommError', (err) => {
  console.error('Panel error:', err);
});
