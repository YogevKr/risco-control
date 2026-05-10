const SEVERITY_ORDER = Object.freeze({
  critical: 0,
  issue: 1,
  warning: 2,
  info: 3,
});

function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function isPresentSecret(info) {
  return !!(info && info.present);
}

function isWeakSecret(info) {
  return !!(info && info.present && info.weak);
}

function normalizeLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isDefaultNumberedLabel(label, id) {
  const s = normalizeLabel(label).toLowerCase();
  if (!s) return false;
  const n = String(id);
  const padded = n.padStart(2, '0');
  return (
    s === n ||
    s === padded ||
    s.startsWith(`${n} `) ||
    s.startsWith(`${padded} `) ||
    s === `user ${n}` ||
    s === `zone ${n}` ||
    s === `${n} אזור` ||
    s === `${padded} אזור` ||
    s === `${n} קבוצה` ||
    s === `${padded} קבוצה` ||
    s === `schedule ${n}` ||
    s === `program ${n}`
  );
}

function formatIds(ids, limit = 12) {
  if (!ids.length) return '';
  const shown = ids.slice(0, limit).join(', ');
  return ids.length > limit ? `${shown} +${ids.length - limit} more` : shown;
}

function parsePanelDate(value) {
  const s = String(value || '').trim();
  if (!s || s.startsWith('00/00')) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(toInt(m[3]), toInt(m[2]) - 1, toInt(m[1]), toInt(m[4]), toInt(m[5]));
}

function daysSincePanelDate(value, now = new Date()) {
  const d = parsePanelDate(value);
  if (!d) return null;
  return (now.getTime() - d.getTime()) / 86400000;
}

function parseIpv4(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number.parseInt(part, 10));
  if (bytes.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) return null;
  return bytes;
}

function ipv4ToInt(bytes) {
  return bytes.reduce((n, byte) => ((n << 8) | byte) >>> 0, 0);
}

function sameSubnet(ip, gateway, subnet) {
  const ipBytes = parseIpv4(ip);
  const gatewayBytes = parseIpv4(gateway);
  const subnetBytes = parseIpv4(subnet);
  if (!ipBytes || !gatewayBytes || !subnetBytes) return null;
  const mask = ipv4ToInt(subnetBytes);
  return (ipv4ToInt(ipBytes) & mask) === (ipv4ToInt(gatewayBytes) & mask);
}

function addFinding(findings, finding) {
  findings.push({
    severity: 'warning',
    refs: [],
    ...finding,
  });
}

function assessSystem(snapshot, findings) {
  const system = snapshot.system || {};
  const sstt = String(system.sstt || '').padEnd(24, '-');
  const batteryVoltage = Number.parseFloat(system.batteryVoltage);

  if (Number.isFinite(batteryVoltage)) {
    if (batteryVoltage < 12) {
      addFinding(findings, {
        severity: 'issue',
        category: 'System',
        code: 'panel_battery_low',
        title: 'Panel battery is low',
        detail: `Main battery reads ${batteryVoltage.toFixed(1)}V.`,
        action: 'Replace or load-test the panel backup battery.',
      });
    } else if (batteryVoltage < 13) {
      addFinding(findings, {
        severity: 'warning',
        category: 'System',
        code: 'panel_battery_marginal',
        title: 'Panel battery is marginal',
        detail: `Main battery reads ${batteryVoltage.toFixed(1)}V.`,
        action: 'Watch voltage and replace the backup battery if it drops further.',
      });
    }
  }

  const flags = [
    ['B', 0, 'issue', 'system_low_battery', 'System low battery flag active', 'Check the panel backup battery.'],
    ['A', 1, 'issue', 'system_ac_fail', 'AC power failure flag active', 'Check transformer, outlet, and panel power wiring.'],
    ['P', 2, 'warning', 'phone_line_trouble', 'Phone line trouble flag active', 'Disable unused PSTN reporting or fix the phone line path.'],
    ['C', 3, 'warning', 'clock_trouble', 'Clock trouble flag active', 'Set panel time and verify NTP/time settings.'],
    ['D', 4, 'issue', 'default_enabled', 'Default mode flag active', 'Review programming state and changed factory defaults.'],
    ['1', 5, 'warning', 'monitoring_station_1_trouble', 'Monitoring station 1 trouble', 'Verify monitoring station configuration and reporting path.'],
    ['2', 6, 'warning', 'monitoring_station_2_trouble', 'Monitoring station 2 trouble', 'Verify monitoring station configuration and reporting path.'],
    ['T', 8, 'issue', 'box_tamper', 'Box tamper active', 'Check enclosure cover and tamper switch.'],
    ['J', 9, 'issue', 'rf_jamming', 'RF jamming trouble active', 'Check RF noise and nearby wireless interference.'],
    ['I', 10, 'warning', 'programming_mode', 'Panel is in programming mode', 'Exit programming mode after changes are complete.'],
    ['F', 14, 'issue', 'system_bell_trouble', 'Bell/siren trouble active', 'Check siren wiring, tamper, fuse, and siren supervision settings.'],
  ];

  for (const [flag, idx, severity, code, title, action] of flags) {
    if (sstt[idx] === flag) {
      addFinding(findings, {
        severity,
        category: 'System',
        code,
        title,
        detail: `SSTT=${system.sstt || ''}`,
        action,
      });
    }
  }
}

function assessGsm(snapshot, findings) {
  const gsm = snapshot.gsm || {};
  const health = gsm.health;
  if (!health) return;

  if (!health.usable) {
    addFinding(findings, {
      severity: health.severity === 'warning' ? 'warning' : 'issue',
      category: 'GSM',
      code: 'gsm_unusable',
      title: 'GSM backup is not healthy',
      detail: `${health.summary}; RSSI ${health.signal.rssi}/31 (${health.signal.dbm} dBm).`,
      action: 'Move/replace the GSM antenna, confirm SIM service, then retest registration and GPRS attachment.',
    });
  }
}

function assessAccess(snapshot, findings) {
  const access = snapshot.access || {};

  if (access.remoteAccess && access.remoteAccess.enabled) {
    const codeInfo = access.remoteAccess.codeInfo || {};
    if (isWeakSecret(codeInfo)) {
      addFinding(findings, {
        severity: 'critical',
        category: 'Access',
        code: 'remote_access_code_weak',
        title: 'Remote access code is weak/default',
        detail: `Remote access is enabled for ID ${access.remoteAccess.remoteId || 'unknown'}.`,
        action: 'Change the remote access code to a unique 6-digit value.',
      });
    } else if (isPresentSecret(codeInfo) && codeInfo.length < 6) {
      addFinding(findings, {
        severity: 'warning',
        category: 'Access',
        code: 'remote_access_code_short',
        title: 'Remote access code is only 4 digits',
        detail: `Remote access is enabled for ID ${access.remoteAccess.remoteId || 'unknown'}.`,
        action: 'Use a 6-digit remote access code if the panel supports it.',
      });
    } else {
      addFinding(findings, {
        severity: 'info',
        category: 'Access',
        code: 'remote_access_enabled',
        title: 'Remote access is enabled',
        detail: `Remote access ID ${access.remoteAccess.remoteId || 'unknown'} is active.`,
        action: 'Keep LAN access restricted to trusted management hosts.',
      });
    }
  }

  if (isWeakSecret(access.installerPinInfo)) {
    addFinding(findings, {
      severity: 'issue',
      category: 'Access',
      code: 'installer_pin_weak',
      title: 'Installer PIN is weak/default',
      detail: 'Installer programming access uses a weak-looking code.',
      action: 'Change the installer PIN to a unique value and store it offline.',
    });
  }

  if (isWeakSecret(access.subInstallerPinInfo)) {
    addFinding(findings, {
      severity: 'issue',
      category: 'Access',
      code: 'sub_installer_pin_weak',
      title: 'Sub-installer PIN is weak/default',
      detail: 'Sub-installer programming access uses a weak-looking code.',
      action: 'Change or disable the sub-installer PIN.',
    });
  }
}

function assessUsers(snapshot, findings) {
  const users = snapshot.users || [];
  const weakIds = users.filter((user) => isWeakSecret(user.pinInfo)).map((user) => user.id);
  const defaultLabelIds = users
    .filter((user) => isDefaultNumberedLabel(user.label, user.id))
    .map((user) => user.id);

  if (weakIds.length) {
    addFinding(findings, {
      severity: 'issue',
      category: 'Users',
      code: 'weak_user_pins',
      title: 'Weak/default user PINs are enabled',
      detail: `Affected users: ${formatIds(weakIds)}.`,
      refs: weakIds.map((id) => `user:${id}`),
      action: 'Disable unused users or assign unique non-obvious PINs.',
    });
  }

  if (defaultLabelIds.length) {
    addFinding(findings, {
      severity: 'warning',
      category: 'Users',
      code: 'default_user_labels',
      title: 'Default-looking user labels remain',
      detail: `Affected users: ${formatIds(defaultLabelIds)}.`,
      refs: defaultLabelIds.map((id) => `user:${id}`),
      action: 'Rename real users and disable/delete unused user slots.',
    });
  }
}

function assessZones(snapshot, findings, now) {
  const zones = snapshot.zones || [];
  const faultIds = [];
  const lowBatteryIds = [];
  const deadIds = [];
  const weakSignalIds = [];
  const watchSignalIds = [];
  const staleIds = [];
  const orphanIds = [];

  for (const zone of zones) {
    const status = zone.status || {};
    const notUsed = !!status.notUsed || toInt(zone.type) === 0;
    const wireless = zone.tech === 'W';

    if (notUsed) {
      const hasWirelessHistory = wireless && (
        toInt(zone.rssi) > 0 ||
        parsePanelDate(zone.lastCheckIn) ||
        parsePanelDate(zone.lastTrigger)
      );
      const hasNonDefaultLabel = !!zone.label && !isDefaultNumberedLabel(zone.label, zone.id);
      if (hasWirelessHistory || hasNonDefaultLabel) {
        orphanIds.push(zone.id);
      }
      continue;
    }

    if (status.lowBattery) lowBatteryIds.push(zone.id);
    if (status.tamper || status.trouble || status.lost || status.commTrouble) faultIds.push(zone.id);

    if (wireless) {
      const checkedIn = parsePanelDate(zone.lastCheckIn);
      const rssi = toInt(zone.rssi);
      if (rssi === 0 && !checkedIn) {
        deadIds.push(zone.id);
      } else if (rssi > 0 && rssi < 20) {
        weakSignalIds.push(zone.id);
      } else if (rssi >= 20 && rssi < 35) {
        watchSignalIds.push(zone.id);
      }

      const ageDays = daysSincePanelDate(zone.lastCheckIn, now);
      if (ageDays !== null && ageDays > 30) {
        staleIds.push(zone.id);
      }
    }
  }

  if (lowBatteryIds.length) {
    addFinding(findings, {
      severity: 'issue',
      category: 'Zones',
      code: 'zone_low_battery',
      title: 'Wireless zone battery low',
      detail: `Affected zones: ${formatIds(lowBatteryIds)}.`,
      refs: lowBatteryIds.map((id) => `zone:${id}`),
      action: 'Replace the sensor batteries and confirm the flag clears.',
    });
  }

  if (faultIds.length) {
    addFinding(findings, {
      severity: 'issue',
      category: 'Zones',
      code: 'zone_faults',
      title: 'Zone tamper/trouble/lost flags active',
      detail: `Affected zones: ${formatIds(faultIds)}.`,
      refs: faultIds.map((id) => `zone:${id}`),
      action: 'Inspect the listed sensors and clear tamper/trouble conditions.',
    });
  }

  if (deadIds.length) {
    addFinding(findings, {
      severity: 'issue',
      category: 'Zones',
      code: 'dead_wireless_zones',
      title: 'Wireless zones have no signal',
      detail: `Affected zones: ${formatIds(deadIds)}.`,
      refs: deadIds.map((id) => `zone:${id}`),
      action: 'Check sensor power, enrollment, and RF range.',
    });
  }

  if (staleIds.length) {
    addFinding(findings, {
      severity: 'warning',
      category: 'Zones',
      code: 'stale_wireless_zones',
      title: 'Wireless zones have stale check-ins',
      detail: `Affected zones: ${formatIds(staleIds)}.`,
      refs: staleIds.map((id) => `zone:${id}`),
      action: 'Trigger each sensor and confirm the panel receives a fresh check-in.',
    });
  }

  if (weakSignalIds.length) {
    addFinding(findings, {
      severity: 'warning',
      category: 'Zones',
      code: 'weak_wireless_signal',
      title: 'Wireless zone signal is weak',
      detail: `Affected zones: ${formatIds(weakSignalIds)}.`,
      refs: weakSignalIds.map((id) => `zone:${id}`),
      action: 'Move sensors, improve antenna placement, or add a repeater.',
    });
  }

  if (orphanIds.length) {
    addFinding(findings, {
      severity: 'warning',
      category: 'Zones',
      code: 'orphan_zone_config',
      title: 'Old/not-used zone config remains',
      detail: `Affected zones: ${formatIds(orphanIds)}.`,
      refs: orphanIds.map((id) => `zone:${id}`),
      action: 'Delete unused zones or rename/enable them intentionally.',
    });
  }

  if (watchSignalIds.length) {
    addFinding(findings, {
      severity: 'info',
      category: 'Zones',
      code: 'watch_wireless_signal',
      title: 'Wireless signal should be watched',
      detail: `Affected zones: ${formatIds(watchSignalIds)}.`,
      refs: watchSignalIds.map((id) => `zone:${id}`),
      action: 'No immediate fix needed; watch for RSSI dropping below 20 or stale check-ins.',
    });
  }
}

function assessCloud(snapshot, findings) {
  const cloud = snapshot.cloud || {};
  if (!cloud.enabled) return;

  if (isWeakSecret(cloud.passwordInfo)) {
    addFinding(findings, {
      severity: 'issue',
      category: 'Cloud',
      code: 'cloud_password_weak',
      title: 'RiscoCloud password is weak/default',
      detail: 'Cloud access is enabled with a weak-looking password.',
      action: 'Change the RiscoCloud password from the panel/app.',
    });
  }

  if (!cloud.encrypted) {
    addFinding(findings, {
      severity: 'warning',
      category: 'Cloud',
      code: 'cloud_encryption_disabled',
      title: 'RiscoCloud encryption flag is disabled',
      detail: 'ELASENCR is false while cloud service is enabled.',
      action: 'Enable it only during a supervised test, then confirm iOS/RiscoCloud still connects.',
    });
  }

  if (cloud.armEnabled || cloud.disarmEnabled) {
    addFinding(findings, {
      severity: 'info',
      category: 'Cloud',
      code: 'cloud_remote_control_enabled',
      title: 'Cloud arm/disarm is enabled',
      detail: `Arm=${cloud.armEnabled ? 'on' : 'off'}, disarm=${cloud.disarmEnabled ? 'on' : 'off'}.`,
      action: 'Keep this only if you actively use cloud remote control.',
    });
  }
}

function assessNetwork(snapshot, findings) {
  const network = snapshot.network || {};
  const same = sameSubnet(network.ip, network.gateway, network.subnet);

  if (same === false) {
    addFinding(findings, {
      severity: 'warning',
      category: 'Network',
      code: 'gateway_outside_subnet',
      title: 'Panel gateway is outside its subnet',
      detail: `IP ${network.ip}, subnet ${network.subnet}, gateway ${network.gateway}.`,
      action: 'Fix the gateway for the alarm VLAN, or confirm outbound cloud access is intentionally blocked.',
    });
  }
}

function summarize(findings) {
  const counts = { critical: 0, issue: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  const highestSeverity = ['critical', 'issue', 'warning', 'info'].find((severity) => counts[severity] > 0) || 'ok';
  return {
    highestSeverity,
    counts,
    openCount: counts.critical + counts.issue + counts.warning,
    watchCount: counts.info,
    totalCount: findings.length,
  };
}

function assessAuditSnapshot(snapshot, options = {}) {
  const now = options.now || new Date();
  const findings = [];

  assessSystem(snapshot, findings);
  assessGsm(snapshot, findings);
  assessAccess(snapshot, findings);
  assessUsers(snapshot, findings);
  assessZones(snapshot, findings, now);
  assessCloud(snapshot, findings);
  assessNetwork(snapshot, findings);

  findings.sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severity !== 0) return severity;
    return `${a.category}:${a.code}`.localeCompare(`${b.category}:${b.code}`);
  });

  return {
    generatedAt: snapshot.generatedAt || now.toISOString(),
    panel: snapshot.panel || {},
    summary: summarize(findings),
    findings,
  };
}

module.exports = {
  assessAuditSnapshot,
  daysSincePanelDate,
  isDefaultNumberedLabel,
  parseIpv4,
  sameSubnet,
};
