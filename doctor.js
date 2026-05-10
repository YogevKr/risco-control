const { createPanel } = require('./panel-runtime');
const { assessGsmHealth } = require('./gsm-health');

const { panel } = createPanel();

function maskIdentifier(value) {
  const s = String(value ?? '').trim();
  if (!s || ['N/A', 'N05', 'N19'].includes(s)) return s;
  return s.length <= 4 ? '{present}' : `{present,ending=${s.slice(-4)}}`;
}

panel.on('SystemInitComplete', async () => {
  const tcp = panel.RiscoComm.TCPSocket;
  const issues = [];
  const warnings = [];
  const info = [];

  async function read(cmd) {
    const r = await tcp.SendCommand(cmd + '?');
    if (r && r.includes('=')) return r.split('=').slice(1).join('=').trim();
    return r;
  }

  console.log('==============================================');
  console.log('  RISCO SYSTEM DOCTOR');
  console.log('  Full diagnostic scan');
  console.log('==============================================\n');

  // ---- SYSTEM ----
  console.log('Scanning system...');
  const sstt = await read('SSTT');
  const mainbat = parseInt(await read('MAINBAT'));
  const batVoltage = (mainbat / 10).toFixed(1);
  const clock = await read('CLOCK');
  const pnlver = await read('PNLVER');
  const servmode = await read('SERVMODE');

  info.push(`Panel: ${pnlver}`);
  info.push(`Clock: ${clock}`);
  info.push(`Battery: ${batVoltage}V (raw: ${mainbat})`);

  if (mainbat < 120) issues.push(`PANEL BATTERY LOW: ${batVoltage}V (should be >12.0V)`);
  else if (mainbat < 130) warnings.push(`Panel battery marginal: ${batVoltage}V (ideally >13.0V)`);

  // Parse system status flags
  if (sstt.includes('F')) warnings.push(`System status flag 'F' present in SSTT: ${sstt}`);

  // Check AC power, tamper, bell etc from SSTT
  const sysFlags = {
    lowBat: sstt[0]==='B', acFail: sstt[1]==='A', phoneTrouble: sstt[2]==='P',
    clockTrouble: sstt[3]==='C', defaultOn: sstt[4]==='D', ms1Trouble: sstt[5]==='1',
    ms2Trouble: sstt[6]==='2', ms3Trouble: sstt[7]==='3', boxTamper: sstt[8]==='T',
    jamming: sstt[9]==='J', progMode: sstt[10]==='I', bellTrouble: sstt[14]==='F',
  };
  if (sysFlags.lowBat) issues.push('SYSTEM: Low battery flag active');
  if (sysFlags.acFail) issues.push('SYSTEM: AC power failure');
  if (sysFlags.phoneTrouble) issues.push('SYSTEM: Phone line trouble');
  if (sysFlags.boxTamper) issues.push('SYSTEM: Box tamper detected!');
  if (sysFlags.jamming) issues.push('SYSTEM: RF jamming detected!');
  if (sysFlags.bellTrouble) warnings.push('SYSTEM: Bell/siren trouble flag active');
  if (sysFlags.ms1Trouble) warnings.push('SYSTEM: Monitoring station 1 trouble');
  if (sysFlags.ms2Trouble) warnings.push('SYSTEM: Monitoring station 2 trouble');
  if (sysFlags.clockTrouble) warnings.push('SYSTEM: Clock trouble');

  if (servmode === 'T' || servmode === 'S') warnings.push(`Panel in service/test mode: ${servmode}`);

  // ---- GSM ----
  console.log('Scanning GSM...');
  const grssi = await read('GRSSI');
  const gsmstt = await read('GSMSTT');
  const gimei = await read('GIMEI');
  const gsmver = await read('GSMVER');
  const gsmHealth = assessGsmHealth(gsmstt, grssi);

  info.push(`GSM: ${gsmver}`);
  info.push(`GSM IMEI: ${maskIdentifier(gimei)}`);
  info.push(`GSM Status: ${gsmHealth.summary} (${gsmstt})`);
  info.push(`GSM RSSI: ${gsmHealth.signal.rssi}/31 (${gsmHealth.signal.dbm} dBm, ${gsmHealth.signal.quality})`);

  for (const finding of gsmHealth.findings) {
    const target = finding.severity === 'issue' ? issues : warnings;
    target.push(`GSM: ${finding.message}`);
  }

  // ---- IP MODULE ----
  console.log('Scanning IP module...');
  const ipcstt = await read('IPCSTT');
  const ipcver = await read('IPCVER');
  const ripaddr = await read('RIPADDR');

  info.push(`IP Module: ${ipcver}`);
  info.push(`IP Address: ${ripaddr}`);

  // ---- CLOUD ----
  console.log('Scanning cloud...');
  const elasen = await read('ELASEN');
  const elasipa = await read('ELASIPA');
  const elaspass = await read('ELASPASS');

  if (elasen === '1') {
    info.push(`RiscoCloud: Enabled -> ${elasipa}`);
    if (elaspass === 'AAAAAA' || elaspass === '000000') warnings.push('CLOUD: Using default password! Change it.');
  } else {
    warnings.push('CLOUD: RiscoCloud is disabled - no remote monitoring');
  }

  // ---- PARTITIONS ----
  console.log('Scanning partitions...');
  for (let i = 1; i <= 4; i++) {
    const pstt = await read(`PSTT*${i}`);
    if (pstt[10] !== 'E') continue; // doesn't exist
    const plbl = await read(`PLBL*${i}`);
    const armed = pstt[6] === 'A';
    const homeStay = pstt[7] === 'H';
    const alarm = pstt[0] === 'a';
    const trouble = pstt[17] === 'T';
    const ready = pstt[8] === 'R';

    info.push(`Partition ${i} (${plbl.trim()}): ${armed ? (homeStay ? 'ARMED HOME' : 'ARMED AWAY') : 'DISARMED'}${ready ? ', Ready' : ', NOT READY'}${trouble ? ', TROUBLE' : ''}`);

    if (alarm) issues.push(`PARTITION ${i} (${plbl.trim()}): ALARM ACTIVE!`);
    if (trouble) warnings.push(`PARTITION ${i} (${plbl.trim()}): Trouble flag active`);
    if (!armed && !homeStay) warnings.push(`PARTITION ${i} (${plbl.trim()}): System is DISARMED`);
  }

  // ---- ZONES ----
  console.log('Scanning all zones...');
  const now = Date.now();
  let totalZones = 0, activeZones = 0, deadZones = 0, lowBatZones = 0, weakSignal = 0;

  for (let i = 1; i <= 50; i++) {
    const ztype = parseInt(await read(`ZTYPE*${i}`));
    const ztech = await read(`ZLNKTYP${i}`);
    if (ztech === 'N' && ztype === 0) continue;
    totalZones++;

    const zlbl = (await read(`ZLBL*${i}`)).trim();
    const zstt = await read(`ZSTT*${i}`);
    const isWireless = ztech === 'W';

    // Parse zone status
    const open = zstt[0] === 'O';
    const tamper = zstt[3] === 'T';
    const trouble = zstt[4] === 'R';
    const lost = zstt[5] === 'L';
    const lowBat = zstt[6] === 'B';
    const bypass = zstt[7] === 'Y';
    const commTrouble = zstt[8] === 'C';
    const notUsed = zstt[11] === 'N';

    if (tamper) issues.push(`ZONE ${i} (${zlbl}): TAMPER detected!`);
    if (trouble) issues.push(`ZONE ${i} (${zlbl}): Trouble flag active`);
    if (lost) issues.push(`ZONE ${i} (${zlbl}): Lost communication`);
    if (commTrouble) issues.push(`ZONE ${i} (${zlbl}): Communication trouble`);
    if (lowBat) { issues.push(`ZONE ${i} (${zlbl}): LOW BATTERY`); lowBatZones++; }
    if (bypass) warnings.push(`ZONE ${i} (${zlbl}): Currently BYPASSED`);

    if (isWireless) {
      const rssi = parseInt(await read(`ZRSSI${i}`), 16) || 0;
      const rssitim = await read(`ZRSSITIM${i}`);
      const rri = await read(`ZRRI${i}`);

      const hasCheckedIn = rssitim && !rssitim.startsWith('00/00');

      if (rssi === 0 && !hasCheckedIn) {
        issues.push(`ZONE ${i} (${zlbl}): DEAD - no signal, never checked in. Last trigger: ${rri || 'never'}`);
        deadZones++;
      } else if (rssi === 0) {
        issues.push(`ZONE ${i} (${zlbl}): No signal (RSSI=0)`);
        deadZones++;
      } else {
        activeZones++;
        // Check signal strength
        if (rssi < 20) {
          warnings.push(`ZONE ${i} (${zlbl}): Very weak signal (RSSI=${rssi}/128)`);
          weakSignal++;
        } else if (rssi < 35) {
          warnings.push(`ZONE ${i} (${zlbl}): Weak signal (RSSI=${rssi}/128) - consider repeater`);
          weakSignal++;
        }

        // Check last check-in staleness
        if (hasCheckedIn) {
          const m = rssitim.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
          if (m) {
            const d = new Date(m[3], m[2]-1, m[1], m[4], m[5]);
            const daysSince = (now - d.getTime()) / (1000*60*60*24);
            if (daysSince > 30) {
              issues.push(`ZONE ${i} (${zlbl}): Last check-in ${Math.floor(daysSince)} days ago! Sensor may be failing.`);
            } else if (daysSince > 7) {
              warnings.push(`ZONE ${i} (${zlbl}): Last check-in ${Math.floor(daysSince)} days ago`);
            }
          }
        }
      }
    } else {
      activeZones++;
    }
  }

  // ---- USERS ----
  console.log('Scanning users...');
  for (let i = 1; i <= 32; i++) {
    const upin = await read(`UPIN*${i}`);
    if (!upin || upin.startsWith('N')) continue;
    const ulbl = (await read(`ULBL*${i}`)).trim();
    if (!ulbl) continue;

    if (upin === '1234' || upin === '0000' || upin === '1111') {
      warnings.push(`USER ${i} (${ulbl}): Using weak/default PIN`);
    }
  }

  // ---- INSTALLER/ACCESS CODES ----
  console.log('Scanning access codes...');
  const instpin = await read('INSTPIN');
  const subpin = await read('SUBPIN');
  const udaccid = await read('UDACCID');

  if (instpin === '0000' || instpin === '1234' || instpin === '4321') {
    warnings.push('INSTALLER PIN is weak/default');
  }
  if (subpin === '0000' || subpin === '1234' || subpin === '1111' || subpin === '2222') {
    warnings.push('SUB-INSTALLER PIN is weak/default');
  }
  if (udaccid === '5678' || udaccid === '0000' || udaccid === '1234') {
    issues.push('REMOTE ACCESS CODE is weak/default - anyone with network access may connect to your panel!');
  }

  // ---- MONITORING STATIONS ----
  console.log('Scanning monitoring...');
  let hasActiveMS = false;
  for (let i = 1; i <= 4; i++) {
    const msphone = (await read(`MSPHONE*${i}`)).trim();
    const msip = (await read(`MSIPA*${i}`)).trim();
    if (msphone || msip) hasActiveMS = true;
  }
  if (!hasActiveMS) warnings.push('MONITORING: No monitoring station configured - alarms will not be reported to a central station');

  // ---- FOLLOW ME ----
  console.log('Scanning notifications...');
  let hasFollowMe = false;
  for (let i = 1; i <= 8; i++) {
    const fmphone = (await read(`FMPHONE*${i}`)).trim();
    const fmmail = (await read(`FMMAIL*${i}`)).trim();
    if (fmphone || fmmail) hasFollowMe = true;
  }
  if (!hasFollowMe) warnings.push('FOLLOW-ME: No phone/email notifications configured');

  // ---- ARMING CONFIG ----
  console.log('Scanning arming config...');
  const entrdly = parseInt(await read('ENTRDLY'));
  const exitdly = parseInt(await read('EXITDLY'));
  const swinger = parseInt(await read('SWINGER'));
  const bellto = parseInt(await read('BELLTO'));

  if (entrdly === 0) warnings.push('ARMING: Entry delay is 0 - instant alarm on entry');
  if (entrdly > 60) warnings.push(`ARMING: Entry delay is very long (${entrdly}s) - gives intruder too much time`);
  if (bellto === 0) warnings.push('ARMING: Bell timeout is 0 - siren may ring indefinitely');
  if (swinger === 0) info.push('Swinger shutdown: disabled');

  // ---- NETWORK ----
  console.log('Scanning network...');
  const imail = await read('IMAIL');
  const iusrnam = await read('IUSRNAM');
  if (imail === 'YourCompany.Com') warnings.push('NETWORK: Email is still default "YourCompany.Com"');

  // ---- REPORT ----
  console.log('\n');
  console.log('==============================================');
  console.log('  DIAGNOSTIC REPORT');
  console.log('==============================================\n');

  console.log(`  Zones: ${totalZones} total, ${activeZones} active, ${deadZones} dead, ${lowBatZones} low battery, ${weakSignal} weak signal\n`);

  if (issues.length === 0 && warnings.length === 0) {
    console.log('  *** ALL CLEAR - No issues found ***\n');
  }

  if (issues.length > 0) {
    console.log(`  CRITICAL ISSUES (${issues.length}):`);
    console.log('  ' + '-'.repeat(42));
    issues.forEach((issue, i) => console.log(`  ${i+1}. ${issue}`));
    console.log('');
  }

  if (warnings.length > 0) {
    console.log(`  WARNINGS (${warnings.length}):`);
    console.log('  ' + '-'.repeat(42));
    warnings.forEach((w, i) => console.log(`  ${i+1}. ${w}`));
    console.log('');
  }

  console.log(`  INFO:`);
  console.log('  ' + '-'.repeat(42));
  info.forEach(i => console.log(`  - ${i}`));

  console.log('\n==============================================');
  console.log('  SCAN COMPLETE');
  console.log('==============================================');

  process.exit(0);
});

panel.on('PanelCommError', (err) => {
  console.error('Panel error:', err);
});
