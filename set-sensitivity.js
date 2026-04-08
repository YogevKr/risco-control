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
  const tcp = panel.RiscoComm.TCPSocket;

  // Read current value
  const before = await tcp.SendCommand('Z2WPRSNS9?');
  console.log(`BEFORE: Z2WPRSNS9 = ${before.split('=')[1]}`);

  // Enter programming mode
  console.log('Entering programming mode...');
  const prog = await tcp.SendCommand('PROG=1', true);
  console.log(`PROG=1 => ${prog}`);

  // Set PIR sensitivity to 3 (higher = more sensitive)
  console.log('Setting Z2WPRSNS9=3 ...');
  const result = await tcp.SendCommand('Z2WPRSNS9=3', true);
  console.log(`Z2WPRSNS9=3 => ${result}`);

  // Read back to confirm
  const after = await tcp.SendCommand('Z2WPRSNS9?', true);
  console.log(`AFTER:  Z2WPRSNS9 = ${after.split('=')[1]}`);

  // Exit programming mode (saves to panel)
  console.log('Exiting programming mode (saving)...');
  try { await tcp.SendCommand('PROG=2', true); } catch(e) {}

  console.log('\nDone!');
  process.exit(0);
});

panel.on('PanelCommError', (err) => {
  console.error('Panel error:', err);
});
