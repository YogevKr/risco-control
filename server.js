const express = require('express');
const RiscoTCPPanel = require('risco-lan-bridge');

const app = express();
app.use(express.json());
// CORS — allow cloud-hosted UI to reach local server
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PANEL_IP = process.env.RISCO_IP || '192.168.40.199';
const PANEL_PORT = parseInt(process.env.RISCO_PORT) || 1000;
const PANEL_PASSWORD = parseInt(process.env.RISCO_PASSWORD) || 5678;
const PANEL_ID = process.env.RISCO_PANEL_ID || '0001';
const PANEL_TYPE = process.env.RISCO_PANEL_TYPE || 'LightSys';
const PORT = parseInt(process.env.PORT) || 3580;

let panel = null;
let tcp = null;
let ready = false;

// ============================================
// Panel Connection
// ============================================
function connectPanel() {
  const Options = {
    Panel_IP: PANEL_IP,
    Panel_Port: PANEL_PORT,
    Panel_Password: PANEL_PASSWORD,
    Panel_Id: PANEL_ID,
    AutoDiscover: true,
    DiscoverCode: true,
    AutoConnect: true,
    SocketMode: 'direct',
  };

  panel = new RiscoTCPPanel[PANEL_TYPE](Options);

  panel.on('SystemInitComplete', () => {
    tcp = panel.RiscoComm.TCPSocket;
    ready = true;
    console.log('Panel connected and ready.');
  });

  panel.on('PanelCommError', (err) => {
    console.error('Panel error:', err);
    ready = false;
  });
}

// ============================================
// Command queue (panel handles one command at a time)
// ============================================
let cmdQueue = Promise.resolve();

function sendCmd(cmd, prog = false) {
  if (!ready) return Promise.reject(new Error('Panel not connected'));
  const p = cmdQueue.then(() => tcp.SendCommand(cmd, prog));
  cmdQueue = p.catch(() => {}); // keep queue going on errors
  return p;
}

// sequential is just Promise.all now since the queue serializes
const sequential = (promises) => Promise.all(promises);

async function readCmd(cmd, prog = false) {
  const r = await sendCmd(`${cmd}?`, prog);
  if (r && r.includes('=')) return r.split('=').slice(1).join('=').trim();
  return r;
}

async function writeCmd(cmd, value) {
  await sendCmd('PROG=1', true);
  const r = await sendCmd(`${cmd}=${value}`, true);
  try { await sendCmd('PROG=2', true); } catch(e) {}
  return r;
}

// ============================================
// API Routes
// ============================================

// -- System Info --
app.get('/api/system', async (req, res) => {
  try {
    const pnlcnf = await readCmd('PNLCNF');
    const pnlver = await readCmd('PNLVER');
    const pnlser = await readCmd('PNLSERD');
    const ipcver = await readCmd('IPCVER');
    const gsmver = await readCmd('GSMVER');
    const clock = await readCmd('CLOCK');
    const lang = await readCmd('LANG');
    const syslbl = await readCmd('SYSLBL');
    const ipaddr = await readCmd('IPADDR');
    const ripaddr = await readCmd('RIPADDR');
    const igateway = await readCmd('IGATEWAY');
    const imac = await readCmd('IMAC');
    const gimei = await readCmd('GIMEI');
    const gsimsn = await readCmd('GSIMSN');
    const mainbat = await readCmd('MAINBAT');
    const sstt = await readCmd('SSTT');
    const gsmstt = await readCmd('GSMSTT');

    res.json({
      panel: { model: pnlcnf, version: pnlver, serial: pnlser, label: syslbl, clock, language: lang },
      ip: { module: ipcver, address: ripaddr, configuredAddr: ipaddr, gateway: igateway, mac: imac },
      gsm: { module: gsmver, imei: gimei, simSerial: gsimsn, status: gsmstt },
      battery: { raw: mainbat, voltage: (parseInt(mainbat) / 10).toFixed(1) + 'V' },
      systemStatus: sstt,
      panelPort: await readCmd('PNLPORT'),
      panelSerial: await readCmd('PNLSER'),
      remoteAccess: { code: await readCmd('UDACCID'), enabled: !!(parseInt(await readCmd('UDEN'))), remoteId: await readCmd('UDRMTID') },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Helper: batch query with COMMAND*min:max? format --
async function batchRead(cmd, min, max) {
  const r = await readCmd(`${cmd}*${min}:${max}`);
  return r ? r.split('\t').map(v => v.trim()) : [];
}

// -- Zones (uses batch commands for speed) --
app.get('/api/zones', async (req, res) => {
  try {
    const zones = [];
    const maxZ = 50;
    // Batch read types, labels, status in chunks of 8
    const allTypes = [], allLabels = [], allStatus = [], allTech = [];
    for (let i = 0; i < maxZ; i += 8) {
      const min = i + 1, max = Math.min(i + 8, maxZ);
      const types = await batchRead('ZTYPE', min, max);
      const labels = await batchRead('ZLBL', min, max);
      const status = await batchRead('ZSTT', min, max);
      allTypes.push(...types); allLabels.push(...labels); allStatus.push(...status);
      // Tech needs per-zone query
      for (let j = min; j <= max; j++) {
        allTech.push(await readCmd(`ZLNKTYP${j}`));
      }
    }

    for (let i = 0; i < maxZ; i++) {
      const type = parseInt(allTypes[i]) || 0;
      const tech = allTech[i] || 'N';
      if (tech === 'N' && type === 0) continue;

      const rssiRaw = await readCmd(`ZRSSI${i+1}`);
      const rssiVal = parseInt(rssiRaw, 16);
      const rri = tech === 'W' ? await readCmd(`ZRRI${i+1}`) : null;
      const rssitim = tech === 'W' ? await readCmd(`ZRSSITIM${i+1}`) : null;
      const zone = {
        id: i + 1, label: (allLabels[i] || '').trim(), type, tech,
        rssi: isNaN(rssiVal) ? 0 : rssiVal,
        lastTrigger: rri ? rri.trim() : null,
        lastCheckIn: rssitim ? rssitim.trim() : null,
        status: parseZoneStatus(allStatus[i] || ''),
      };

      if (tech === 'W') {
        const prsns = await readCmd(`Z2WPRSNS${i+1}`);
        const mwsns = await readCmd(`Z2WMWSNS${i+1}`);
        const plscn = await readCmd(`Z2WPLSCN${i+1}`);
        const enled = await readCmd(`Z2WENLED${i+1}`);
        zone.wireless = {
          pirSensitivity: parseInt(prsns), microwaveSensitivity: parseInt(mwsns),
          pulseCount: parseInt(plscn), ledEnabled: parseInt(enled),
        };
      }
      zones.push(zone);
    }
    res.json(zones);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/zones/:id', async (req, res) => {
  try {
    const i = parseInt(req.params.id);
    const [type, label, status, tech, rssi, rri, conf, force] = await sequential([
      readCmd(`ZTYPE*${i}`), readCmd(`ZLBL*${i}`), readCmd(`ZSTT*${i}`),
      readCmd(`ZLNKTYP${i}`), readCmd(`ZRSSI${i}`), readCmd(`ZRRI${i}`),
      readCmd(`ZCONF${i}`), readCmd(`ZFORCE${i}`),
    ]);

    const zone = {
      id: i, label: label.trim(), type: parseInt(type), tech,
      rssi: parseInt(rssi, 16) || 0, lastReport: rri, config: conf,
      force: parseInt(force), status: parseZoneStatus(status),
    };

    if (tech === 'W') {
      const [prsns, mwsns, enled, envb, ensab, hold, plscn, rsptm, walkts, sksns, smopm] = await sequential([
        readCmd(`Z2WPRSNS${i}`), readCmd(`Z2WMWSNS${i}`), readCmd(`Z2WENLED${i}`),
        readCmd(`Z2WENVB${i}`), readCmd(`Z2WENSAB${i}`), readCmd(`Z2WHOLD${i}`),
        readCmd(`Z2WPLSCN${i}`), readCmd(`Z2WRSPTM${i}`), readCmd(`Z2WALKTS${i}`),
        readCmd(`Z2WSKSNS${i}`), readCmd(`Z2WSMOPM${i}`),
      ]);
      zone.wireless = {
        pirSensitivity: parseInt(prsns), microwaveSensitivity: parseInt(mwsns),
        shockSensitivity: parseInt(sksns), ledEnabled: parseInt(enled),
        vibrationEnabled: parseInt(envb), sabotageEnabled: parseInt(ensab),
        holdTime: parseInt(hold), pulseCount: parseInt(plscn),
        responseTime: parseInt(rsptm), walkTest: parseInt(walkts),
        smokeOpMode: parseInt(smopm),
      };
    }
    res.json(zone);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Zone Actions --
app.post('/api/zones/:id/bypass', async (req, res) => {
  try {
    const r = await sendCmd(`ZBYPAS=${req.params.id}`);
    res.json({ success: r === 'ACK' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/zones/:id/sensitivity', async (req, res) => {
  try {
    const { pirSensitivity, microwaveSensitivity, shockSensitivity } = req.body;
    const results = {};
    if (pirSensitivity !== undefined) results.pir = await writeCmd(`Z2WPRSNS${req.params.id}`, pirSensitivity);
    if (microwaveSensitivity !== undefined) results.mw = await writeCmd(`Z2WMWSNS${req.params.id}`, microwaveSensitivity);
    if (shockSensitivity !== undefined) results.shock = await writeCmd(`Z2WSKSNS${req.params.id}`, shockSensitivity);
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/zones/:id/config', async (req, res) => {
  try {
    const id = req.params.id;
    const results = {};
    const cmds = {
      ledEnabled: 'Z2WENLED', vibrationEnabled: 'Z2WENVB', sabotageEnabled: 'Z2WENSAB',
      holdTime: 'Z2WHOLD', pulseCount: 'Z2WPLSCN', responseTime: 'Z2WRSPTM',
      walkTest: 'Z2WALKTS', label: 'ZLBL', type: 'ZTYPE', force: 'ZFORCE',
      abort: 'ZABORT', chimes: 'ZCHIMES',
    };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(`${cmd}${id}`, req.body[key]);
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Partitions --
app.get('/api/partitions', async (req, res) => {
  try {
    const partitions = [];
    for (let i = 1; i <= 4; i++) {
      const [label, status] = await sequential([readCmd(`PLBL*${i}`), readCmd(`PSTT*${i}`)]);
      partitions.push({ id: i, label: label.trim(), status: parsePartitionStatus(status) });
    }
    res.json(partitions);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/partitions/:id/arm', async (req, res) => {
  try {
    const r = await sendCmd(`ARM=${req.params.id}`);
    res.json({ success: r === 'ACK' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/partitions/:id/arm-stay', async (req, res) => {
  try {
    const r = await sendCmd(`STAY=${req.params.id}`);
    res.json({ success: r === 'ACK' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/partitions/:id/disarm', async (req, res) => {
  try {
    const r = await sendCmd(`DISARM=${req.params.id}`);
    res.json({ success: r === 'ACK' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Outputs --
app.get('/api/outputs', async (req, res) => {
  try {
    const outputs = [];
    for (let i = 1; i <= 32; i++) {
      const [label, type, active, pulse] = await sequential([
        readCmd(`OLBL*${i}`), readCmd(`OTYPE*${i}`), readCmd(`OACTV*${i}`), readCmd(`OPULSE*${i}`),
      ]);
      if (parseInt(type) === 0 && label.trim().startsWith(`${String(i).padStart(2, '0')} `)) continue;
      outputs.push({ id: i, label: label.trim(), type: parseInt(type), active: parseInt(active), pulse: parseInt(pulse) });
    }
    res.json(outputs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/outputs/:id/activate', async (req, res) => {
  try {
    const r = await sendCmd(`ACTUO${req.params.id}`);
    res.json({ success: r === 'ACK' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Users --
app.get('/api/users', async (req, res) => {
  try {
    const users = [];
    for (let i = 1; i <= 32; i++) {
      const [label, level, pin, prox] = await sequential([
        readCmd(`ULBL*${i}`), readCmd(`ULVL*${i}`), readCmd(`UPIN*${i}`), readCmd(`UPROX*${i}`),
      ]);
      if (!label || label.trim() === '' || label.includes('N05')) continue;
      users.push({ id: i, label: label.trim(), level: parseInt(level), pin, prox });
    }
    res.json(users);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Keypads --
app.get('/api/keypads', async (req, res) => {
  try {
    const keypads = [];
    for (let i = 1; i <= 8; i++) {
      const [label, status, func, rssi] = await sequential([
        readCmd(`KPLABEL*${i}`), readCmd(`KPSTT*${i}`), readCmd(`KPFUNC*${i}`), readCmd(`KPRSSI*${i}`),
      ]);
      if (label.includes('N05')) continue;
      keypads.push({ id: i, label: label.trim(), status, function: parseInt(func), rssi: parseInt(rssi) });
    }
    res.json(keypads);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Keyfobs --
app.get('/api/keyfobs', async (req, res) => {
  try {
    const fobs = [];
    for (let i = 1; i <= 32; i++) {
      const [label, rssi, parent, b1, b2] = await sequential([
        readCmd(`FBLABEL*${i}`), readCmd(`FBRSSI*${i}`), readCmd(`FBPARENT*${i}`),
        readCmd(`FB1TYP*${i}`), readCmd(`FB2TYP*${i}`),
      ]);
      if (label.includes('N05') || !label) continue;
      fobs.push({ id: i, label: label.trim(), rssi: parseInt(rssi), parent: parseInt(parent), button1Type: parseInt(b1), button2Type: parseInt(b2) });
    }
    res.json(fobs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Follow Me --
app.get('/api/followme', async (req, res) => {
  try {
    const entries = [];
    for (let i = 1; i <= 8; i++) {
      const [label, phone, mail, chnl, en] = await sequential([
        readCmd(`FMLBL*${i}`), readCmd(`FMPHONE*${i}`), readCmd(`FMMAIL*${i}`),
        readCmd(`FMCHNL*${i}`), readCmd(`FMEN*${i}`),
      ]);
      if (label.includes('N05')) continue;
      const events = {};
      const [alarm, arm, darm, emrg, fire, panic, open, tech, tmpr, zbat] = await sequential([
        readCmd(`FMALRM${i}`), readCmd(`FMARM${i}`), readCmd(`FMDARM${i}`),
        readCmd(`FMEMRG${i}`), readCmd(`FMFIRE${i}`), readCmd(`FMPNIC${i}`),
        readCmd(`FMOPEN${i}`), readCmd(`FMTECH${i}`), readCmd(`FMTMPR${i}`), readCmd(`FMZBAT${i}`),
      ]);
      events.alarm = !!parseInt(alarm); events.arm = !!parseInt(arm); events.disarm = !!parseInt(darm);
      events.emergency = !!parseInt(emrg); events.fire = !!parseInt(fire); events.panic = !!parseInt(panic);
      events.open = !!parseInt(open); events.technical = !!parseInt(tech); events.tamper = !!parseInt(tmpr);
      events.zoneBattery = !!parseInt(zbat);
      entries.push({ id: i, label: label.trim(), phone: phone.trim(), email: mail.trim(), channel: parseInt(chnl), events });
    }
    res.json(entries);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Monitoring Station --
app.get('/api/monitoring', async (req, res) => {
  try {
    const stations = [];
    for (let i = 1; i <= 4; i++) {
      const [acct, phone, ip, port, chnl, bckp] = await sequential([
        readCmd(`MSACCNT*${i}`), readCmd(`MSPHONE*${i}`), readCmd(`MSIPA*${i}`),
        readCmd(`MSIPP*${i}`), readCmd(`MSCHNL*${i}`), readCmd(`MSBCKP*${i}`),
      ]);
      stations.push({ id: i, account: acct.trim(), phone: phone.trim(), ip: ip.trim(), port: parseInt(port), channel: parseInt(chnl), backup: parseInt(bckp) });
    }
    res.json(stations);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Network Config --
app.get('/api/network', async (req, res) => {
  try {
    const [ip, subnet, gateway, mac, dns, netbios, dhcp, smtp, smtpPort] = await sequential([
      readCmd('RIPADDR'), readCmd('ISUBNET'), readCmd('IGATEWAY'), readCmd('IMAC'),
      readCmd('IDNS'), readCmd('INETBIOS'), readCmd('DHCP'), readCmd('ISMTP'), readCmd('ISMTPP'),
    ]);
    res.json({ ip, subnet, gateway, mac, dns, netbios, dhcp, smtp, smtpPort });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Cloud (RiscoCloud/ELAS) --
app.get('/api/cloud', async (req, res) => {
  try {
    const [enabled, ip, port, pass, arm, darm, delay, backup, encrypt] = await sequential([
      readCmd('ELASEN'), readCmd('ELASIPA'), readCmd('ELASIPP'), readCmd('ELASPASS'),
      readCmd('ELASARM'), readCmd('ELASDARM'), readCmd('ELASDLY'), readCmd('ELASBCKP'), readCmd('ELASENCR'),
    ]);
    res.json({
      enabled: !!parseInt(enabled), server: ip, port: parseInt(port), password: pass,
      armEnabled: !!parseInt(arm), disarmEnabled: !!parseInt(darm),
      delay: parseInt(delay), backup: parseInt(backup), encrypted: !!parseInt(encrypt),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- GSM Module --
app.get('/api/gsm', async (req, res) => {
  try {
    const [ver, imei, sim, rssi, status, apn, provider, netlos, simpin, simexp, callid, polPr, polBk, polSec] = await sequential([
      readCmd('GSMVER'), readCmd('GIMEI'), readCmd('GSIMSN'), readCmd('GRSSI'),
      readCmd('GSMSTT'), readCmd('GAPN'), readCmd('GPRVDR'), readCmd('GNETLOS'),
      readCmd('SIMPIN'), readCmd('SIMEXP'), readCmd('GCALLID'),
      readCmd('GSPOLPR'), readCmd('GSPOLBKP'), readCmd('GSPOLSEC'),
    ]);
    const rssiVal = parseInt(rssi) || 0;
    // AT+CSQ scale: 0=-113dBm, 1=-111dBm, 2-30 linear, 31=-51dBm
    const dbm = rssiVal === 0 ? -113 : rssiVal === 1 ? -111 : rssiVal >= 31 ? -51 : -113 + (rssiVal * 2);
    const bars = rssiVal === 0 ? 0 : rssiVal <= 5 ? 1 : rssiVal <= 10 ? 2 : rssiVal <= 20 ? 3 : rssiVal <= 25 ? 4 : 5;
    const quality = ['No signal','Very weak','Weak','Fair','Good','Excellent'][bars];
    // GSMSTT flags
    const sttFlags = {
      registered: status[0] !== '-',
      gprsAttached: status[1] !== '-',
      simInserted: status[2] === 'Q' || status[2] !== '-',
      networkAvail: status[3] !== '-',
    };
    res.json({
      version: ver, imei, simSerial: sim,
      signal: { rssi: rssiVal, dbm, bars, quality },
      status, statusFlags: sttFlags,
      apn, provider: provider || '', networkLoss: parseInt(netlos),
      simPin: simpin || '', simExpiry: parseInt(simexp), callerId: parseInt(callid),
      polling: { primary: parseInt(polPr), backup: parseInt(polBk), seconds: parseInt(polSec) },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Schedules --
app.get('/api/schedules', async (req, res) => {
  try {
    const schedules = [];
    for (let i = 1; i <= 8; i++) {
      const [label, type, on, armMode] = await sequential([
        readCmd(`SCLABEL*${i}`), readCmd(`SCTYPE*${i}`), readCmd(`SCON*${i}`), readCmd(`SCARMMD*${i}`),
      ]);
      if (label.includes('N05')) continue;
      schedules.push({ id: i, label: label.trim(), type: parseInt(type), enabled: !!parseInt(on), armMode: parseInt(armMode) });
    }
    res.json(schedules);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Arming Config --
app.get('/api/arming-config', async (req, res) => {
  try {
    const [entryDly, exitDly, bellTimeout, bellDly, swinger, quickArm, quickBypass,
           bypassAlways, exitRestrict, warnArm, abortAlarm, silentInstall] = await sequential([
      readCmd('ENTRDLY'), readCmd('EXITDLY'), readCmd('BELLTO'), readCmd('BELLDLY'),
      readCmd('SWINGER'), readCmd('QARM'), readCmd('QBYP'),
      readCmd('BYPALW'), readCmd('EXITREST'), readCmd('WRNARM'),
      readCmd('ABORTALM'), readCmd('SILNTINS'),
    ]);
    res.json({
      entryDelay: parseInt(entryDly), exitDelay: parseInt(exitDly),
      bellTimeout: parseInt(bellTimeout), bellDelay: parseInt(bellDly),
      swingerShutdown: parseInt(swinger), quickArm: !!parseInt(quickArm),
      quickBypass: !!parseInt(quickBypass), bypassAlways: !!parseInt(bypassAlways),
      exitRestrict: !!parseInt(exitRestrict), warnBeforeArm: !!parseInt(warnArm),
      abortAlarm: !!parseInt(abortAlarm), silentInstall: !!parseInt(silentInstall),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Raw Command --
app.post('/api/raw', async (req, res) => {
  try {
    const { command, prog } = req.body;
    if (prog) await sendCmd('PROG=1', true);
    const r = await sendCmd(command, !!prog);
    if (prog) try { await sendCmd('PROG=2', true); } catch(e) {}
    res.json({ response: r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Event Log --
app.get('/api/events', async (req, res) => {
  try {
    const events = [];
    for (let i = 1; i <= 50; i++) {
      const r = await readCmd(`ELOG${i}`);
      if (!r || r.startsWith('N')) break;
      events.push({ id: i, raw: r });
    }
    res.json(events);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// WRITE ENDPOINTS — Full CS.exe coverage
// ============================================

// -- Generic write helper for any setting --
app.put('/api/setting', async (req, res) => {
  try {
    const { command, value } = req.body;
    const r = await writeCmd(command, value);
    res.json({ success: r === 'ACK', response: r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Write: Users --
app.put('/api/users/:id', async (req, res) => {
  try {
    const id = req.params.id, results = {};
    const cmds = { label: 'ULBL', level: 'ULVL', pin: 'UPIN', prox: 'UPROX', partition: 'UPART', parent: 'UPARENT', outputAssign: 'UOASSIGN' };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(`${cmd}${id}`, req.body[key]);
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Write: Network --
app.put('/api/network', async (req, res) => {
  try {
    const results = {};
    const cmds = { ip: 'RIPADDR', subnet: 'ISUBNET', gateway: 'IGATEWAY', dns: 'IDNS', netbios: 'INETBIOS', dhcp: 'DHCP', smtp: 'ISMTP', smtpPort: 'ISMTPP', mail: 'IMAIL', username: 'IUSRNAM', password: 'IUSRPWD' };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(cmd, req.body[key]);
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Write: Cloud/ELAS --
app.put('/api/cloud', async (req, res) => {
  try {
    const results = {};
    const cmds = { enabled: 'ELASEN', server: 'ELASIPA', port: 'ELASIPP', password: 'ELASPASS', armEnabled: 'ELASARM', disarmEnabled: 'ELASDARM', delay: 'ELASDLY', backup: 'ELASBCKP', encrypted: 'ELASENCR' };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(cmd, typeof req.body[key] === 'boolean' ? (req.body[key] ? 1 : 0) : req.body[key]);
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Write: GSM --
app.put('/api/gsm', async (req, res) => {
  try {
    const results = {};
    const cmds = { apn: 'GAPN', provider: 'GPRVDR', password: 'GPWD', center: 'GCENTER', name: 'GNAME', simPin: 'SIMPIN', callerId: 'GCALLID' };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(cmd, req.body[key]);
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Write: Follow Me --
app.put('/api/followme/:id', async (req, res) => {
  try {
    const id = req.params.id, results = {};
    const cmds = {
      label: 'FMLBL', phone: 'FMPHONE', email: 'FMMAIL', channel: 'FMCHNL',
      alarm: 'FMALRM', arm: 'FMARM', disarm: 'FMDARM', emergency: 'FMEMRG',
      fire: 'FMFIRE', panic: 'FMPNIC', open: 'FMOPEN', technical: 'FMTECH',
      tamper: 'FMTMPR', zoneBattery: 'FMZBAT', bypass: 'FMBYPS', listen: 'FMLISTN',
      duress: 'FMDURS', flood: 'FMFLOOD', gas: 'FMGAS', highTemp: 'FMHITMP',
      lowTemp: 'FMLOTMP', noMovement: 'FMNOMOVE', programming: 'FMPROG',
      sim: 'FMSIM', simTrouble: 'FMSIMTRB', gsm: 'FMGSM', ipnet: 'FMIPNET',
      jamming: 'FMJAM', provider: 'FMPROV', zoneList: 'FMZLST', partition: 'FMPART',
      // Restore variants
      restoreAlarm: 'FMRALRM', restoreBypass: 'FMRBYPS', restoreEmergency: 'FMREMRG',
      restoreFire: 'FMRFIRE', restorePanic: 'FMRPNIC', restoreTech: 'FMRTECH',
      restoreTamper: 'FMRTMPR', restoreBattery: 'FMRZBAT',
    };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) {
        const val = typeof req.body[key] === 'boolean' ? (req.body[key] ? 1 : 0) : req.body[key];
        results[key] = await writeCmd(`${cmd}${id}`, val);
      }
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Write: Monitoring Station --
app.put('/api/monitoring/:id', async (req, res) => {
  try {
    const id = req.params.id, results = {};
    const cmds = { account: 'MSACCNT', phone: 'MSPHONE', ip: 'MSIPA', port: 'MSIPP', channel: 'MSCHNL', backup: 'MSBCKP', lineNum: 'MSLINUM', format: 'MSFRMT', enabled: 'MSEN', arm: 'MSARM', noArm: 'MSNOARM', urgent: 'MSURG', nonUrgent: 'MSNURG', tries: 'MSTRIES' };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(`${cmd}${id}`, req.body[key]);
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Write: Arming Config --
app.put('/api/arming-config', async (req, res) => {
  try {
    const results = {};
    const cmds = {
      entryDelay: 'ENTRDLY', exitDelay: 'EXITDLY', bellTimeout: 'BELLTO', bellDelay: 'BELLDLY',
      swingerShutdown: 'SWINGER', quickArm: 'QARM', quickBypass: 'QBYP', bypassAlways: 'BYPALW',
      exitRestrict: 'EXITREST', warnBeforeArm: 'WRNARM', abortAlarm: 'ABORTALM',
      silentInstall: 'SILNTINS', entryBypass: 'ENTRBYP', entryDisarm: 'ENTRDIS',
      entryDoorArm: 'ENTRDAR', exitAlarm: 'EXITAL', acDelay: 'ACDLY',
      autoStay: 'CPAUTSTY', threeMinBypass: 'CP3MINBP', keyswLock: 'KSWLOCK',
      finalLength: 'FINLNGHT', fireRepeat: 'FIREPT', phoneDelay: 'PHDLY',
      panicAlarm: 'PANCAL', speakerLevel: 'SPKRLVL', listenIn: 'LISTENIN',
    };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) {
        const val = typeof req.body[key] === 'boolean' ? (req.body[key] ? 1 : 0) : req.body[key];
        results[key] = await writeCmd(cmd, val);
      }
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Write: Outputs --
app.put('/api/outputs/:id', async (req, res) => {
  try {
    const id = req.params.id, results = {};
    const cmds = { label: 'OLBL', type: 'OTYPE', pulse: 'OPULSE', active: 'OACTV', deactive: 'ODACTV', follow: 'OFLLOW', group: 'OGROP', partition: 'OPART', user: 'OUSER', zone: 'OZONE' };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(`${cmd}${id}`, req.body[key]);
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Write: Partitions --
app.put('/api/partitions/:id', async (req, res) => {
  try {
    const id = req.params.id, results = {};
    if (req.body.label !== undefined) results.label = await writeCmd(`PLBL${id}`, req.body.label);
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Write: Keypads --
app.put('/api/keypads/:id', async (req, res) => {
  try {
    const id = req.params.id, results = {};
    const cmds = { label: 'KPLABEL', function: 'KPFUNC', melody: 'KPMELODY', mode: 'KPMODE', autoStay: 'KPAUTOST', bypassCode: 'KPBYPCOD', emergency: 'KPEMRGCY', wakeup: 'KPWAKEUP' };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(`${cmd}${id}`, req.body[key]);
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Write: Keyfobs --
app.put('/api/keyfobs/:id', async (req, res) => {
  try {
    const id = req.params.id, results = {};
    const cmds = { label: 'FBLABEL', parent: 'FBPARENT', button1Type: 'FB1TYP', button2Type: 'FB2TYP', button3Type: 'FB3TYP', button4Type: 'FB4TYP', button3Output: 'FB3OUT', button4Output: 'FB4OUT', pin: 'FB2WPIN', panic: 'FB2WPANC' };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(`${cmd}${id}`, req.body[key]);
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// READ ENDPOINTS — Missing categories
// ============================================

// -- Sirens --
app.get('/api/sirens', async (req, res) => {
  try {
    const sirens = [];
    for (let i = 1; i <= 8; i++) {
      const stype = await readCmd(`STYPE*${i}`);
      const srssi = await readCmd(`SRSSI*${i}`);
      const rssitm = await readCmd(`SRSSITIM*${i}`);
      const snver = await readCmd(`SNVER*${i}`);
      const sndal = await readCmd(`SSNDAL*${i}`);
      const sndsq = await readCmd(`SSNDSQ*${i}`);
      const str = await readCmd(`SSTR*${i}`);
      const strblk = await readCmd(`SSTRBLK*${i}`);
      const strsq = await readCmd(`SSTRSQ*${i}`);
      const sv = await readCmd(`SSV*${i}`);
      if (stype.startsWith('N')) continue;
      sirens.push({
        id: i, type: parseInt(stype), rssi: parseInt(srssi), rssiTime: rssitm, version: snver,
        soundAlarm: parseInt(sndal), soundSquawk: parseInt(sndsq),
        strobe: parseInt(str), strobeBlock: parseInt(strblk), strobeSquawk: parseInt(strsq),
        supervisionVersion: parseInt(sv), strobeSquawkS: parseInt(await readCmd(`SSTRSQS*${i}`)),
      });
    }
    res.json(sirens);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/sirens/:id', async (req, res) => {
  try {
    const id = req.params.id, results = {};
    const cmds = { type: 'STYPE', soundAlarm: 'SSNDAL', soundSquawk: 'SSNDSQ', strobe: 'SSTR', strobeBlock: 'SSTRBLK', strobeSquawk: 'SSTRSQ', partition: 'SPART', speakerLevel: 'SPKRLVL', noiseLevel: 'RPNOISEL' };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(`${cmd}${id}`, req.body[key]);
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Vacations --
app.get('/api/vacations', async (req, res) => {
  try {
    const vacations = [];
    for (let i = 1; i <= 4; i++) {
      const enabled = await readCmd(`VACEN*${i}`);
      const dateStart = await readCmd(`VACDATS*${i}`);
      const dateEnd = await readCmd(`VACDATE*${i}`);
      const label = await readCmd(`VACLABEL*${i}`);
      const partition = await readCmd(`VACPART*${i}`);
      if (enabled.startsWith('N')) continue;
      vacations.push({ id: i, enabled: !!parseInt(enabled), label: (label||'').trim(), start: dateStart, end: dateEnd, partition: parseInt(partition) });
    }
    res.json(vacations);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vacations/:id', async (req, res) => {
  try {
    const id = req.params.id, results = {};
    const cmds = { enabled: 'VACEN', label: 'VACLABEL', start: 'VACDATS', end: 'VACDATE', partition: 'VACPART' };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(`${cmd}${id}`, typeof req.body[key] === 'boolean' ? (req.body[key] ? 1 : 0) : req.body[key]);
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Schedules (full day/time details) --
app.get('/api/schedules/:id', async (req, res) => {
  try {
    const i = req.params.id;
    const label = await readCmd(`SCLABEL*${i}`);
    const type = await readCmd(`SCTYPE*${i}`);
    const on = await readCmd(`SCON*${i}`);
    const armMode = await readCmd(`SCARMMD*${i}`);
    const output = await readCmd(`SCUO*${i}`);
    const mask = await readCmd(`SCMASK*${i}`);
    const vacf = await readCmd(`SCVACF*${i}`);
    // Day/time pairs: Sun-Sat start/end
    const days = {};
    const dayMap = { sun: 'SU', mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA' };
    for (const [name, code] of Object.entries(dayMap)) {
      const start = await readCmd(`SC${code}S*${i}`);
      const end = await readCmd(`SC${code}E*${i}`);
      days[name] = { start, end };
    }
    const vacStart = await readCmd(`SCVACS*${i}`);
    const vacEnd = await readCmd(`SCVACE*${i}`);
    res.json({
      id: parseInt(i), label: (label||'').trim(), type: parseInt(type), enabled: !!parseInt(on),
      armMode: parseInt(armMode), output: parseInt(output), mask, vacationFollow: parseInt(vacf),
      days, vacation: { start: vacStart, end: vacEnd },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/schedules/:id', async (req, res) => {
  try {
    const id = req.params.id, results = {};
    const cmds = { label: 'SCLABEL', type: 'SCTYPE', enabled: 'SCON', armMode: 'SCARMMD', output: 'SCUO', mask: 'SCMASK', vacationFollow: 'SCVACF' };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(`${cmd}${id}`, typeof req.body[key] === 'boolean' ? (req.body[key] ? 1 : 0) : req.body[key]);
    }
    // Day/time writes
    const dayMap = { sun: 'SU', mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA' };
    if (req.body.days) {
      for (const [name, code] of Object.entries(dayMap)) {
        if (req.body.days[name]) {
          if (req.body.days[name].start !== undefined) results[`${name}Start`] = await writeCmd(`SC${code}S${id}`, req.body.days[name].start);
          if (req.body.days[name].end !== undefined) results[`${name}End`] = await writeCmd(`SC${code}E${id}`, req.body.days[name].end);
        }
      }
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Macros --
app.get('/api/macros', async (req, res) => {
  try {
    const macros = [];
    for (const [name, prefix] of [['A','MACROA'],['B','MACROB'],['C','MACROC']]) {
      const label = await readCmd(`${prefix}LABEL1`);
      const key = await readCmd(`${prefix}KEY1`);
      const val = await readCmd(`${prefix}1`);
      macros.push({ name, label: (label||'').trim(), key: (key||'').trim(), value: (val||'').trim() });
    }
    res.json(macros);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- IO Expanders --
app.get('/api/io-expanders', async (req, res) => {
  try {
    const expanders = [];
    for (let i = 1; i <= 8; i++) {
      const house = await readCmd(`IOHOUSE*${i}`);
      const rssi = await readCmd(`IORSSI*${i}`);
      const sn = await readCmd(`IOSN*${i}`);
      const stt = await readCmd(`IOSTT*${i}`);
      const sv = await readCmd(`IOSV*${i}`);
      const ver = await readCmd(`IOVER*${i}`);
      if (house.startsWith('N') || stt.startsWith('N')) continue;
      expanders.push({ id: i, house: parseInt(house), rssi: parseInt(rssi), serial: sn, status: stt, sv: parseInt(sv), version: ver });
    }
    res.json(expanders);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Repeaters --
app.get('/api/repeaters', async (req, res) => {
  try {
    const repeaters = [];
    for (let i = 1; i <= 4; i++) {
      const label = await readCmd(`RPLBL*${i}`);
      const rssi = await readCmd(`RPRSSI*${i}`);
      const batt = await readCmd(`RPBATT*${i}`);
      const stt = await readCmd(`RPSTT*${i}`);
      const ver = await readCmd(`RPVER*${i}`);
      if (label.startsWith('N') || stt.startsWith('N')) continue;
      repeaters.push({ id: i, label: (label||'').trim(), rssi: parseInt(rssi), battery: parseInt(batt), status: stt, version: ver });
    }
    res.json(repeaters);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Write: System settings --
app.put('/api/system', async (req, res) => {
  try {
    const results = {};
    const cmds = {
      label: 'SYSLBL', clock: 'CLOCK', language: 'LANG', timezone: 'TIMEZONE',
      installerPin: 'INSTPIN', subPin: 'SUBPIN', remotePhoneCode: 'RMTPHCD',
      sixDigit: 'SIXDIG', batteryMode: 'BATMOD', serviceMode: 'SERVMODE',
      testMode: 'TESTMODE', jammingAlarm: 'JAMAL', jammingTime: 'JMTIME',
      pbx: 'PBX', rings: 'RINGS', redial: 'REDIAL',
    };
    for (const [key, cmd] of Object.entries(cmds)) {
      if (req.body[key] !== undefined) results[key] = await writeCmd(cmd, req.body[key]);
    }
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- RF Test --
app.post('/api/rf-test', async (req, res) => {
  try {
    const r = await sendCmd('RFTEST');
    res.json({ success: r === 'ACK', response: r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/rf-test/stop', async (req, res) => {
  try {
    const r = await sendCmd('RFTESTF');
    res.json({ success: r === 'ACK', response: r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Zone: delete/add --
app.delete('/api/zones/:id', async (req, res) => {
  try {
    const r = await writeCmd(`DELZONE`, req.params.id);
    res.json({ success: r === 'ACK', response: r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Reset --
app.post('/api/reset-tech', async (req, res) => {
  try {
    const r = await sendCmd('RSTTECH');
    res.json({ success: r === 'ACK' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Announcements --
app.get('/api/announcements', async (req, res) => {
  try {
    const ann = {};
    const cmds = {
      arm: 'ANNARM', armPr: 'ANNARMPR', armSt: 'ANNARMST', atArm: 'ANNATARM',
      disarm: 'ANNDIS', emergency: 'ANNEMERG', fire: 'ANNFIRE', intrusion: 'ANNINT',
      misc: 'ANNMISC', noMovement: 'ANNNOMOV', output: 'ANNOUT', panic: 'ANNPANC',
      status: 'ANNSTS', technical: 'ANNTECH', tamper: 'ANNTMP', walkTest: 'ANNWALKT',
    };
    for (const [key, cmd] of Object.entries(cmds)) {
      ann[key] = parseInt(await readCmd(`${cmd}1`)) || 0;
    }
    res.json(ann);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Firmware info --
app.get('/api/firmware', async (req, res) => {
  try {
    const server = await readCmd('SWUSRVR');
    const file = await readCmd('SWUFILE');
    const port = await readCmd('SWUPORT');
    const cmdG = await readCmd('SWUCMNDG');
    const cmdI = await readCmd('SWUCMNDI');
    res.json({ server, file, port: parseInt(port), commandGprs: cmdG, commandIp: cmdI });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// ALL SETTINGS — every remaining command
// ============================================
app.get('/api/all-settings', async (req, res) => {
  try {
    const r = {};
    const cmds = [
      'AMTMP','ANSMCHN','AREA','AREACODE','AUTODLS','BATMOD','BELLSQ','BUZBELL',
      'BYPBOX','BYPEE','CALLBACK','CODTRBL','CONFENG','CONFSTRT','CONFWND',
      'CP3MINBP','CPAUTSTY','CPEXTERR','CPLASTEX','CUSTOMER','DARMSTP','DTWTIME',
      'ENALMEM','ENATT','ENAUTIN','ENBLENG','ENDFLT','ENELOG','ENRSTRBL',
      'ENTRBYP','ENTRDAR','ENTRDIS','EXITAL','EXTBPSTY','FINLNGHT','FIREPT','FRCKSW',
      'GETRSSI','JAMAL','JMTIME','KSWLOCK','LBARM','LISTENIN','LVLEA','LVLEXEN',
      'MAINBAT','NOACTV','PANCAL','PBX','PHAL','PHDLY','PNLPORT',
      'QARM','QBYP','REDIAL','RINGS','RMTPHCD','ROUTDIS','RSTON','RSTTECH',
      'SERVMODE','SIAPART','SIATEXT','SIXDIG','SUBPIN','SV20MIN','SVTIME','SVTO',
      'SWINGER','SYSLBL','TIMEZONE','TMPRENG','TMPRSND','TMPRTECH',
      'UDACCID','UDEN','UDRMTID','VIEWHS','VIEWKO','VMREOCUR','WRNARM',
    ];
    for (const cmd of cmds) {
      try { r[cmd] = await readCmd(cmd); } catch(e) { r[cmd] = 'ERR'; }
    }
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Extended Network (all IP settings) --
app.get('/api/network-full', async (req, res) => {
  try {
    res.json({
      ip: await readCmd('RIPADDR'), configuredIp: await readCmd('IPADDR'),
      subnet: await readCmd('ISUBNET'), gateway: await readCmd('IGATEWAY'),
      mac: await readCmd('IMAC'), dns: await readCmd('IDNS'),
      netbios: await readCmd('INETBIOS'), mail: await readCmd('IMAIL'),
      username: await readCmd('IUSRNAM'), password: await readCmd('IUSRPWD'),
      smtp: await readCmd('ISMTP'), smtpPort: await readCmd('ISMTPP'),
      ntp: await readCmd('INTP'), ntpPort: await readCmd('INTPP'), ntpProto: await readCmd('INTPPROT'),
      keepAliveCnt: await readCmd('IKACNT'), keepAliveRes: await readCmd('IKARES'),
      messageQueue: await readCmd('IMQ'), name: await readCmd('INAME'),
      ipcStatus: await readCmd('IPCSTT'), ipcVersion: await readCmd('IPCVER'),
      phone: await readCmd('IPHONE'),
      pollingPrimary: await readCmd('IPPOLPR'), pollingBackup: await readCmd('IPPOLBKP'),
      pollingSeconds: await readCmd('IPPOLSEC'),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Extended GSM (all GSM settings) --
app.get('/api/gsm-full', async (req, res) => {
  try {
    res.json({
      version: await readCmd('GSMVER'), imei: await readCmd('GIMEI'),
      simSerial: await readCmd('GSIMSN'), rssi: parseInt(await readCmd('GRSSI')),
      status: await readCmd('GSMSTT'), apn: await readCmd('GAPN'),
      provider: await readCmd('GPRVDR'), center: await readCmd('GCENTER'),
      callerId: await readCmd('GCALLID'), incomingCall: await readCmd('GINCAL'),
      mail: await readCmd('GMAIL'), name: await readCmd('GNAME'),
      networkLoss: await readCmd('GNETLOS'), password: await readCmd('GPWD'),
      getrssi: await readCmd('GETRSSI'),
      serverIp: await readCmd('GSIP'), serverPort: await readCmd('GSIPP'),
      serverName: await readCmd('GSNAME'), serverPwd: await readCmd('GSPWD'),
      dupPhone: await readCmd('GTDUPPHN'),
      pollingPrimary: await readCmd('GSPOLPR'), pollingBackup: await readCmd('GSPOLBKP'),
      pollingSeconds: await readCmd('GSPOLSEC'),
      simPin: await readCmd('SIMPIN'), simExpiry: await readCmd('SIMEXP'),
      simPpc: await readCmd('SIMPPC'), simPpp: await readCmd('SIMPPP'), simPpt: await readCmd('SIMPPT'),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Extended Zone detail (ALL fields) --
app.get('/api/zones/:id/full', async (req, res) => {
  try {
    const i = req.params.id;
    const r = {
      id: parseInt(i), type: await readCmd(`ZTYPE*${i}`), label: await readCmd(`ZLBL*${i}`),
      status: await readCmd(`ZSTT*${i}`), tech: await readCmd(`ZLNKTYP${i}`),
      rssi: await readCmd(`ZRSSI${i}`), rssiTime: await readCmd(`ZRSSITIM${i}`),
      lastReport: await readCmd(`ZRRI${i}`), config: await readCmd(`ZCONF${i}`),
      force: await readCmd(`ZFORCE${i}`), abort: await readCmd(`ZABORT${i}`),
      noActivity: await readCmd(`ZNACTV${i}`), enabled: await readCmd(`ZNEN${i}`),
      test: await readCmd(`ZTST${i}`), in1Term: await readCmd(`ZIN1TERM${i}`),
      in2Term: await readCmd(`ZIN2TERM${i}`),
    };
    // Wireless-specific
    const tech = r.tech;
    if (tech === 'W') {
      r.wireless = {
        pirSens: await readCmd(`Z2WPRSNS${i}`), mwSens: await readCmd(`Z2WMWSNS${i}`),
        led: await readCmd(`Z2WENLED${i}`), vibration: await readCmd(`Z2WENVB${i}`),
        sabotage: await readCmd(`Z2WENSAB${i}`), hold: await readCmd(`Z2WHOLD${i}`),
        pulseCount: await readCmd(`Z2WPLSCN${i}`), responseTime: await readCmd(`Z2WRSPTM${i}`),
        walkTest: await readCmd(`Z2WALKTS${i}`), am: await readCmd(`Z2WENAM${i}`),
        rsWen: await readCmd(`Z2WRSWEN${i}`), smokeMode: await readCmd(`Z2WSMOPM${i}`),
      };
    }
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Extended Follow Me (ALL fields per entry) --
app.get('/api/followme/:id/full', async (req, res) => {
  try {
    const i = req.params.id;
    const r = {
      id: parseInt(i), label: await readCmd(`FMLBL*${i}`), phone: await readCmd(`FMPHONE*${i}`),
      mail: await readCmd(`FMMAIL*${i}`), channel: await readCmd(`FMCHNL*${i}`),
      parent: await readCmd(`FMPARENT*${i}`), partition: await readCmd(`FMPART*${i}`),
      period: await readCmd(`FMPERIOD*${i}`), phoneEnable: await readCmd(`FMPHNE*${i}`),
      backup: await readCmd(`FMBCKP*${i}`), code: await readCmd(`FMCODE*${i}`),
      listen: await readCmd(`FMLISTN*${i}`), co: await readCmd(`FMCO*${i}`),
      dc: await readCmd(`FMDC*${i}`), rac: await readCmd(`FMRAC*${i}`),
      events: {
        alarm: await readCmd(`FMALRM${i}`), arm: await readCmd(`FMARM${i}`),
        disarm: await readCmd(`FMDARM${i}`), emergency: await readCmd(`FMEMRG${i}`),
        fire: await readCmd(`FMFIRE${i}`), panic: await readCmd(`FMPNIC${i}`),
        open: await readCmd(`FMOPEN${i}`), duress: await readCmd(`FMDURS${i}`),
        tech: await readCmd(`FMTECH${i}`), tamper: await readCmd(`FMTMPR${i}`),
        zoneBat: await readCmd(`FMZBAT${i}`), zoneList: await readCmd(`FMZLST${i}`),
        bypass: await readCmd(`FMBYPS${i}`), flood: await readCmd(`FMFLOOD${i}`),
        gas: await readCmd(`FMGAS${i}`), gsm: await readCmd(`FMGSM${i}`),
        hiTemp: await readCmd(`FMHITMP${i}`), loTemp: await readCmd(`FMLOTMP${i}`),
        ipnet: await readCmd(`FMIPNET${i}`), jam: await readCmd(`FMJAM${i}`),
        noMove: await readCmd(`FMNOMOVE${i}`), prog: await readCmd(`FMPROG${i}`),
        provider: await readCmd(`FMPROV${i}`), sim: await readCmd(`FMSIM${i}`),
        simTrouble: await readCmd(`FMSIMTRB${i}`),
      },
      restores: {
        alarm: await readCmd(`FMRALRM${i}`), bypass: await readCmd(`FMRBYPS${i}`),
        co: await readCmd(`FMRCO${i}`), code: await readCmd(`FMRCODE${i}`),
        dc: await readCmd(`FMRDC${i}`), duress: await readCmd(`FMRDURS${i}`),
        emergency: await readCmd(`FMREMRG${i}`), fire: await readCmd(`FMRFIRE${i}`),
        flood: await readCmd(`FMRFLOOD${i}`), gas: await readCmd(`FMRGAS${i}`),
        gsm: await readCmd(`FMRGSM${i}`), hiTemp: await readCmd(`FMRHITMP${i}`),
        ipnet: await readCmd(`FMRIPNET${i}`), jam: await readCmd(`FMRJAM${i}`),
        loTemp: await readCmd(`FMRLOTMP${i}`), phone: await readCmd(`FMRPHNE${i}`),
        panic: await readCmd(`FMRPNIC${i}`), prog: await readCmd(`FMRPROG${i}`),
        provider: await readCmd(`FMRPROV${i}`), sim: await readCmd(`FMRSIM${i}`),
        tech: await readCmd(`FMRTECH${i}`), tamper: await readCmd(`FMRTMPR${i}`),
        zoneBat: await readCmd(`FMRZBAT${i}`), zoneList: await readCmd(`FMRZLST${i}`),
      },
    };
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Extended Keypad (ALL fields) --
app.get('/api/keypads/:id/full', async (req, res) => {
  try {
    const i = req.params.id;
    res.json({
      id: parseInt(i), label: await readCmd(`KPLABEL*${i}`), status: await readCmd(`KPSTT*${i}`),
      function: await readCmd(`KPFUNC*${i}`), rssi: await readCmd(`KPRSSI*${i}`),
      rssiTime: await readCmd(`KPRSSITM*${i}`), autoStay: await readCmd(`KPAUTOST*${i}`),
      ask2: await readCmd(`KPASK2*${i}`), ask3: await readCmd(`KPASK3*${i}`),
      sv: await readCmd(`KPSV*${i}`),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Extended Monitoring (ALL fields) --
app.get('/api/monitoring/:id/full', async (req, res) => {
  try {
    const i = req.params.id;
    res.json({
      id: parseInt(i), account: await readCmd(`MSACCNT*${i}`), phone: await readCmd(`MSPHONE*${i}`),
      ip: await readCmd(`MSIPA*${i}`), port: await readCmd(`MSIPP*${i}`),
      channel: await readCmd(`MSCHNL*${i}`), backup: await readCmd(`MSBCKP*${i}`),
      keyBin: await readCmd(`MSKEYBIN*${i}`), lineNum: await readCmd(`MSLINUM*${i}`),
      recordNum: await readCmd(`MSRECNUM*${i}`),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- SIA Reporting --
app.get('/api/sia', async (req, res) => {
  try {
    res.json({ partition: await readCmd('SIAPART'), text: await readCmd('SIATEXT') });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- MS Lock --
app.get('/api/mslock', async (req, res) => {
  try { res.json({ lock: await readCmd('MSLOCK') }); } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// Status parsers
// ============================================
function parseZoneStatus(s) {
  if (!s || s.length < 12) return {};
  return {
    open: s[0] === 'O', armed: s[1] === 'A', alarm: s[2] === 'a',
    tamper: s[3] === 'T', trouble: s[4] === 'R', lost: s[5] === 'L',
    lowBattery: s[6] === 'B', bypass: s[7] === 'Y', commTrouble: s[8] === 'C',
    soakTest: s[9] === 'S', hours24: s[10] === 'H', notUsed: s[11] === 'N',
  };
}

function parsePartitionStatus(s) {
  if (!s || s.length < 18) return {};
  return {
    alarm: s[0] === 'a', duress: s[1] === 'D', falseCode: s[2] === 'C',
    fire: s[3] === 'F', panic: s[4] === 'P', medic: s[5] === 'M',
    armed: s[6] === 'A', homeStay: s[7] === 'H', ready: s[8] === 'R',
    zoneOpen: s[9] === 'O', exist: s[10] === 'E', resetRequired: s[11] === 'S',
    noActivity: s[12] === 'N', grpA: s[13] === '1', grpB: s[14] === '2',
    grpC: s[15] === '3', grpD: s[16] === '4', trouble: s[17] === 'T',
  };
}

// ============================================
// Web UI — served from separate file, or inline fallback
// ============================================
const fs = require('fs');
const path = require('path');
app.get('/', (req, res) => {
  const uiPath = path.join(__dirname, 'ui.html');
  if (fs.existsSync(uiPath)) {
    res.sendFile(uiPath);
  } else {
    // Fallback: redirect to GitHub Pages hosted UI
    res.redirect('https://yogevkriger.github.io/risco-control/?server=' + encodeURIComponent('http://' + req.hostname + ':' + PORT));
  }
});

// ============================================
// Start
// ============================================
connectPanel();
app.listen(PORT, () => {
  console.log(`\n===========================================`);
  console.log(`  RISCO CONTROL CENTER`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`===========================================\n`);
});
