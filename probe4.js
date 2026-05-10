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
  console.log('=== PIR SENSITIVITY PROBE ===\n');

  const tcp = panel.RiscoComm.TCPSocket;
  const ZONE = 9;

  // First, get all info about zone 9 and 24 for comparison
  console.log('--- Full zone info: Zone 9 (דלת כניסה) vs Zone 24 (מטבח פנימי) ---');
  for (const z of [9, 24]) {
    console.log(`\nZone ${z}:`);
    for (const cmd of [
      `ZTYPE*${z}?`, `ZLBL*${z}?`, `ZSTT*${z}?`, `ZPART&*${z}?`,
      `ZAREA&*${z}?`, `ZLNKTYP${z}?`, `ZCONF${z}?`, `ZRSSI${z}?`
    ]) {
      try {
        const r = await tcp.SendCommand(cmd);
        console.log(`  ${cmd.padEnd(18)} => ${r}`);
      } catch(e) {}
    }
  }

  // Enter prog mode for deeper access
  console.log('\n\nEntering programming mode...');
  await tcp.SendCommand('PROG=1', true);

  // Now systematically try 3-letter Z prefixes + zone number
  console.log('\n--- 3-letter Z__ prefix probe (zone 9) ---');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let hits = [];

  for (let i = 0; i < chars.length; i++) {
    for (let j = 0; j < chars.length; j++) {
      const cmd = `Z${chars[i]}${chars[j]}${ZONE}?`;
      try {
        const result = await tcp.SendCommand(cmd, true);
        if (result && !result.startsWith('N')) {
          console.log(`  *** HIT *** ${cmd.padEnd(12)} => ${result}`);
          hits.push(cmd.replace('9?', ''));
        }
      } catch (e) {}
    }
  }

  // Try 4-letter Z prefixes with known common patterns
  console.log('\n--- 4-letter Z___ prefix probe (zone 9) ---');
  const fourLetterPrefixes = [
    'ZCON', 'ZCNF', 'ZCFG', 'ZPRM', 'ZPIR', 'ZSEN', 'ZSNS',
    'ZWIR', 'ZWLS', 'ZWSN', 'ZWCF', 'ZWPR', 'ZWDT', 'ZWSE',
    'ZDLY', 'ZDEL', 'ZENT', 'ZEXI', 'ZALM', 'ZALR', 'ZDET',
    'ZRSP', 'ZRES', 'ZSWN', 'ZSWI', 'ZCHM', 'ZCHR', 'ZFRC',
    'ZFOR', 'ZCRS', 'ZCRZ', 'ZBYP', 'ZTMP', 'ZTAM', 'ZSUP',
    'ZSPR', 'ZPUL', 'ZPLS', 'ZSPD', 'ZTHR', 'ZTRS',
    'ZWLK', 'ZACT', 'ZOPT', 'ZFLG', 'ZMOD', 'ZMSK',
    'ZLNK', 'ZRFL', 'ZREG', 'ZSIG', 'ZSTR', 'ZCNT',
    'ZEVT', 'ZLOG', 'ZINF', 'ZDAT', 'ZDMP', 'ZALL',
    'ZGRP', 'ZARM', 'ZSTA', 'ZSTS',
  ];

  for (const pfx of fourLetterPrefixes) {
    for (const sfx of ['', '*']) {
      const cmd = `${pfx}${sfx}${ZONE}?`;
      try {
        const result = await tcp.SendCommand(cmd, true);
        if (result && !result.startsWith('N')) {
          console.log(`  *** HIT *** ${cmd.padEnd(16)} => ${result}`);
          hits.push(cmd.replace('9?', ''));
        }
      } catch (e) {}
    }
  }

  // Try 5-letter prefixes
  console.log('\n--- 5-letter Z____ prefix probe (zone 9) ---');
  const fiveLetterPrefixes = [
    'ZCONF', 'ZRSSI', 'ZTYPE', 'ZSENS', 'ZPIRM', 'ZPIRS',
    'ZWALK', 'ZFORC', 'ZSWNG', 'ZCHIM', 'ZCROS', 'ZBYPS',
    'ZTAMP', 'ZSUPR', 'ZPULS', 'ZSPEE', 'ZTHRS', 'ZDELA',
    'ZENTR', 'ZEXIT', 'ZALRM', 'ZRESP', 'ZLINK', 'ZFLAG',
    'ZMODE', 'ZMASK', 'ZSIGN', 'ZEVEN',
  ];

  for (const pfx of fiveLetterPrefixes) {
    for (const sfx of ['', '*']) {
      const cmd = `${pfx}${sfx}${ZONE}?`;
      try {
        const result = await tcp.SendCommand(cmd, true);
        if (result && !result.startsWith('N')) {
          console.log(`  *** HIT *** ${cmd.padEnd(18)} => ${result}`);
          hits.push(cmd.replace('9?', ''));
        }
      } catch (e) {}
    }
  }

  // Also try non-zone global PIR/sensitivity commands
  console.log('\n--- Global sensitivity / PIR commands ---');
  const globalCmds = [
    'PIRSENS?', 'PIRSEN?', 'PIRSET?', 'PIRMOD?', 'PIRCFG?',
    'SENSLVL?', 'SENSCFG?', 'DETCFG?', 'DETSNS?',
    'WIRSENS?', 'WLSSENS?', 'RFZONE?',
    'TEFWVER?', 'EDTEFWVER?',
    'WZONE?', 'WZNCFG?', 'WDETCFG?',
    'DCFG?', 'DMOD?', 'DSET?',
  ];

  for (const cmd of globalCmds) {
    try {
      const result = await tcp.SendCommand(cmd, true);
      if (result && !result.startsWith('N')) {
        console.log(`  *** HIT *** ${cmd.padEnd(18)} => ${result}`);
      }
    } catch (e) {}
  }

  // Exit prog mode
  console.log('\nExiting prog mode...');
  try { await tcp.SendCommand('PROG=2', true); } catch(e) {}

  console.log(`\n=== SUMMARY: ${hits.length} hits found ===`);
  hits.forEach(h => console.log(`  ${h}`));
  console.log('\n=== PROBE COMPLETE ===');
  process.exit(0);
});

panel.on('PanelCommError', (err) => {
  console.error('Panel error:', err);
});
