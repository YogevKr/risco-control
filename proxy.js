const net = require('net');
const fs = require('fs');

// Proxy listens locally, forwards to the real panel
const PANEL_IP = '192.168.40.199';
const PANEL_PORT = 1000;
const LISTEN_PORT = 1000;  // CS.exe connects here
const LOG_FILE = './capture.log';

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function hexDump(buffer) {
  const hex = buffer.toString('hex').match(/.{1,2}/g).join(' ');
  const ascii = Array.from(buffer).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
  return `[${buffer.length} bytes] ${hex}\n  ASCII: ${ascii}`;
}

function log(direction, data) {
  const ts = new Date().toISOString();
  const msg = `${ts} ${direction}\n${hexDump(data)}\n`;
  process.stdout.write(msg);
  logStream.write(msg);
}

const server = net.createServer((clientSocket) => {
  console.log(`\n>>> CS.exe connected from ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
  logStream.write(`\n=== NEW CONNECTION from ${clientSocket.remoteAddress}:${clientSocket.remotePort} ===\n`);

  const panelSocket = net.createConnection({ host: PANEL_IP, port: PANEL_PORT }, () => {
    console.log(`>>> Connected to panel at ${PANEL_IP}:${PANEL_PORT}`);
  });

  // CS.exe -> Panel
  clientSocket.on('data', (data) => {
    log('CS.exe >>> PANEL', data);
    panelSocket.write(data);
  });

  // Panel -> CS.exe
  panelSocket.on('data', (data) => {
    log('PANEL >>> CS.exe', data);
    clientSocket.write(data);
  });

  clientSocket.on('end', () => {
    console.log('>>> CS.exe disconnected');
    panelSocket.end();
  });

  panelSocket.on('end', () => {
    console.log('>>> Panel disconnected');
    clientSocket.end();
  });

  clientSocket.on('error', (err) => {
    console.error('CS.exe socket error:', err.message);
    panelSocket.destroy();
  });

  panelSocket.on('error', (err) => {
    console.error('Panel socket error:', err.message);
    clientSocket.destroy();
  });
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  const ifaces = require('os').networkInterfaces();
  const ips = Object.values(ifaces).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);

  console.log('===========================================');
  console.log('  RISCO PROTOCOL CAPTURE PROXY');
  console.log('===========================================');
  console.log(`  Listening on port ${LISTEN_PORT}`);
  console.log(`  Forwarding to ${PANEL_IP}:${PANEL_PORT}`);
  console.log(`  Logging to ${LOG_FILE}`);
  console.log('');
  console.log('  In CS.exe, set panel IP to one of:');
  ips.forEach(ip => console.log(`    ${ip}`));
  console.log('');
  console.log('  Then change sensitivity and we capture the command!');
  console.log('===========================================');
  console.log('  Waiting for CS.exe connection...\n');
});

server.on('error', (err) => {
  if (err.code === 'EACCES') {
    console.error(`Port ${LISTEN_PORT} requires elevated privileges. Run with sudo or change LISTEN_PORT to 10000.`);
  } else {
    console.error('Server error:', err.message);
  }
});
