function parseGsmSignal(rawRssi) {
  const parsed = Number.parseInt(rawRssi, 10);
  const rssi = Number.isFinite(parsed) ? parsed : 0;
  const dbm = rssi === 0 ? -113 : rssi === 1 ? -111 : rssi >= 31 ? -51 : -113 + rssi * 2;
  const bars = rssi === 0 ? 0 : rssi <= 5 ? 1 : rssi <= 10 ? 2 : rssi <= 20 ? 3 : rssi <= 25 ? 4 : 5;
  const quality = ['No signal', 'Very weak', 'Weak', 'Fair', 'Good', 'Excellent'][bars];

  return { rssi, dbm, bars, quality };
}

function decodeGsmStatus(rawStatus) {
  const raw = String(rawStatus || '');
  const status = raw.padEnd(8, '-');

  return {
    raw,
    registered: status[0] !== '-',
    gprsAttached: status[1] !== '-',
    simInserted: status[2] === 'Q' || status[2] !== '-',
    networkAvail: status[3] !== '-',
  };
}

function assessGsmHealth(rawStatus, rawRssi) {
  const statusFlags = decodeGsmStatus(rawStatus);
  const signal = parseGsmSignal(rawRssi);
  const findings = [];

  if (!statusFlags.simInserted) {
    findings.push({ severity: 'issue', code: 'sim_missing', message: 'SIM is not detected' });
  }
  if (!statusFlags.registered) {
    findings.push({ severity: 'issue', code: 'not_registered', message: 'GSM is not registered on the cellular network' });
  }
  if (!statusFlags.gprsAttached) {
    findings.push({ severity: 'issue', code: 'not_attached', message: 'GPRS/data attachment is not active' });
  }
  if (signal.rssi === 0) {
    findings.push({ severity: 'issue', code: 'no_signal', message: 'GSM has no signal' });
  } else if (signal.rssi <= 5) {
    findings.push({ severity: 'issue', code: 'very_weak_signal', message: 'GSM signal is very weak' });
  } else if (signal.rssi <= 10) {
    findings.push({ severity: 'warning', code: 'weak_signal', message: 'GSM signal is weak' });
  }

  const hasIssues = findings.some((finding) => finding.severity === 'issue');
  const hasWarnings = findings.some((finding) => finding.severity === 'warning');
  const usable = statusFlags.simInserted && statusFlags.registered && statusFlags.gprsAttached && signal.rssi > 5;
  const summary = usable
    ? `Ready (${signal.quality})`
    : [
        statusFlags.simInserted ? 'SIM present' : 'SIM missing',
        statusFlags.registered ? 'registered' : 'not registered',
        statusFlags.gprsAttached ? 'GPRS attached' : 'GPRS not attached',
        signal.quality.toLowerCase(),
      ].join(', ');

  return {
    usable,
    severity: hasIssues ? 'issue' : hasWarnings ? 'warning' : 'ok',
    summary,
    statusFlags,
    signal,
    findings,
  };
}

module.exports = {
  assessGsmHealth,
  decodeGsmStatus,
  parseGsmSignal,
};
