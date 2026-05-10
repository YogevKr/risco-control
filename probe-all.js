const RiscoTCPPanel = require('risco-lan-bridge');
const fs = require('fs');

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

// Commands that need a zone/device index
const INDEXED_CMDS = [
  // Zones (Z prefix)
  'ZABORT','ZALOC','ZBYPAS','ZCHIMES','ZCONF','ZCRC','ZFORCE',
  'ZIN1TERM','ZIN2TERM','ZLBL','ZNACTV','ZNEN','ZNGLBL','ZNOTI',
  'ZNOTILOG','ZNREP','ZNSHINPR','ZNVER','ZONEDESC','ZPART','ZRRI',
  'ZRSSI','ZRSSITIM','ZSN','ZSOUND','ZSTT','ZTST','ZTYPE',
  // 2-Way Wireless
  'Z2WALKTS','Z2WENAM','Z2WENLED','Z2WENSAB','Z2WENVB','Z2WHOLD',
  'Z2WMWSNS','Z2WPLSCN','Z2WPRSNS','Z2WRSPTM','Z2WRSWEN','Z2WSKSNS','Z2WSMOPM',
  // Outputs (O prefix)
  'OACTV','ODACTV','OFLLOW','OGROP','OLBL','OPART','OPULSE','OTYPE','OUSER','OVRDFLT','OZONE',
  // Partitions (P prefix)
  'PLBL','PSTT',
  // Users (U prefix)
  'ULBL','ULVL','UOASSIGN','UOSTT','UPARENT','UPART','UPIN','UPRNTL','UPROX',
  // Keypads (KP prefix)
  'KPALOC','KPASK','KPASK2','KPASK3','KPAUTOST','KPBYPCOD','KPDLCD','KPDSER',
  'KPDVER','KPEMRGCY','KPEXENBP','KPFUNC','KPLABEL','KPMELODY','KPMODE',
  'KPONEWAY','KPPROX','KPREP','KPRSSI','KPRSSITM','KPSN','KPSTT','KPSV','KPVER','KPWAKEUP',
  // Follow Me (FM prefix)
  'FMALRM','FMARM','FMBATCRG','FMBATCRGR','FMBCKP','FMBYPS','FMCALLAL',
  'FMCHNL','FMCO','FMCODE','FMCOM','FMCRC','FMDARM','FMDC','FMDURS',
  'FMEMRG','FMEN','FMFIRE','FMFLOOD','FMGAS','FMGSM','FMHITMP','FMIPNET',
  'FMJAM','FMLBL','FMLISTN','FMLOTMP','FMMAIL','FMNOMOVE','FMOPEN',
  'FMPARENT','FMPART','FMPERIOD','FMPHNE','FMPHONE','FMPNIC','FMPROG',
  'FMPROV','FMRAC','FMRALRM','FMRBYPS','FMRCO','FMRCODE','FMRDC',
  'FMRDURS','FMREMRG','FMRFIRE','FMRFLOOD','FMRGAS','FMRGSM','FMRHITMP',
  'FMRIPNET','FMRJAM','FMRLOTMP','FMRPHNE','FMRPNIC','FMRPROG','FMRPROV',
  'FMRSIM','FMRTECH','FMRTMPR','FMRZBAT','FMRZLST','FMSIM','FMSIMTRB',
  'FMTECH','FMTMPR','FMTRIES','FMTSTDAY','FMTSTHR','FMTSTMIN','FMTSTYP','FMZBAT','FMZLST',
  // Monitoring Station (MS prefix)
  'MSACCNT','MSARM','MSBCKP','MSCALLAL','MSCHNL','MSDLY','MSEN','MSFMRT',
  'MSFRMT','MSIPA','MSIPP','MSKEYBIN','MSLINUM','MSNOARM','MSNURG',
  'MSPHONE','MSRECNUM','MSTRIES','MSTSTDAY','MSTSTHR','MSTSTMIN','MSTSTRND','MSTSTYP','MSURG',
  // Keyfobs (FB prefix)
  'FB1TYP','FB2TYP','FB2WASK','FB2WAWIN','FB2WDARM','FB2WPANC','FB2WPIN',
  'FB2WSTIN','FB3OUT','FB3TYP','FB4OUT','FB4TYP','FBLABEL','FBPARENT','FBRSSI','FBSN','FBVER',
  // Sirens (S prefix - some)
  'SALOC','SLABEL','SLVLAL','SLVLEA','SLVLSQ','SNCALIB','SNMUTCMD',
  'SNSTT','SNTEST','SNVER','SPART','SPKRLVL','SREP','SRNPAL','SRSSI',
  'SRSSITIM','SSN','SSNDAL','SSNDSQ','SSTR','SSTRBLK','SSTRSQ','SSTRSQS','SSV','STYPE',
  // Camera (CAM prefix)
  'CAMCOLOR','CAMFOLCN','CAMFOLDU','CAMFOLFI','CAMFOLIN','CAMFOLMD',
  'CAMFOLNA','CAMFOLPN','CAMFOLTM','CAMFRINT','CAMFZN','CAMLCOMP',
  'CAMNUMPC','CAMPREEV','CAMTRIG','CAMVGA',
  // Reporting Codes (RC prefix)
  'RCAARM','RCAC','RCACR','RCADARM','RCAFLT','RCALLCEN','RCALLCST',
  'RCBAKC','RCBAT','RCBATEND','RCBATR','RCBATSTR','RCBRMPRR','RCBTMPR',
  'RCCAL','RCCHOLD','RCCLCMR','RCCLCMTR','RCCLK','RCCLKR','RCCNCL',
  'RCCOD','RCCODR','RCCRC','RCDURS','RCDURSR','RCEXTRR','RCFARM',
  'RCFBARM','RCFBAT','RCFBATR','RCFDARM','RCFIRE','RCFIRER',
  // Schedules (SC prefix)
  'SCARMMD','SCFRE','SCFRS','SCLABEL','SCMASK','SCMOE','SCMOS','SCON',
  'SCSAE','SCSAS','SCSUE','SCSUS','SCTHE','SCTHS','SCTUE','SCTUS',
  'SCTYPE','SCUO','SCVACE','SCVACF','SCVACS','SCWEE','SCWES',
  // Macro (MACRO prefix)
  'MACROA','MACROAKEY','MACROALABEL','MACROB','MACROBKEY','MACROBLABEL',
  'MACROC','MACROCKEY','MACROCLABEL',
  // IO expanders
  'IOALOC','IOHOUSE','IOREP','IORSSI','IOSN','IOSTT','IOSV','IOVER',
  // Repeaters
  'RPALOC','RPBATT','RPCALIB','RPLBL','RPNOISEL','RPRSSI','RPRSSITIM',
  'RPSN','RPSTT','RPSV','RPUNAS','RPVER',
  // Announcements
  'ANNARM','ANNARMPR','ANNARMST','ANNATARM','ANNDIS','ANNEMERG','ANNFIRE',
  'ANNINT','ANNMISC','ANNNOMOV','ANNOUT','ANNPANC','ANNSTS','ANNTECH','ANNTMP','ANNWALKT',
  // Vacation
  'VACDATE','VACDATS','VACEN','VACLABEL','VACPART',
];

// Global commands (no index needed)
const GLOBAL_CMDS = [
  'ABORTALM','ACDLY','AMTMP','ANSMCHN','AREA','AREACODE','AUDIOCALTURE',
  'AUDIOSELECT','AUTODLS','BATMOD','BELL','BELLDLY','BELLSQ','BELLTO',
  'BOOTRES','BUZBELL','BUZZER','BUZZMIC','BUZZTST','BYP','BYPALW',
  'BYPBOX','BYPEE','CALIB','CALLBACK','CHIMEOFF','CLOCK','CODTRBL',
  'CONF','CONFENG','CONFSTRT','CONFWND','CORRMOD','CORRWND','CORRZ',
  'CP3MINBP','CPAUTSTY','CPEXTERR','CPLASTEX','CSENGCSD','CSENGIN',
  'CSENGOUT','CSENIPC','CSENMODM','CSGPRSIP','CSGPRSPORT','CUSDEF',
  'CUSTOMER','DARMSTP','DBVER','DEFAULT','DELALL','DHCP','DIALWAIT',
  'DSSRER','DSSRLVL','DSSRN','DTWTIME','ELASARM','ELASBCKP','ELASDARM',
  'ELASDLY','ELASEN','ELASENCR','ELASIPA','ELASIPP','ELASPASS','ELOG',
  'ENALMEM','ENATT','ENAUTIN','ENBLENG','ENDEV','ENDFLT','ENELOG',
  'ENRSTRBL','ENTRBYP','ENTRDAR','ENTRDIS','ENTRDLY','EXITAL','EXITDLY',
  'EXITREST','EXTBPSTY','EZRPORT','EZRSPNS','EZRST','EZTERM','F1WAY',
  'FINLNGHT','FIREPT','FMAC','FPART','FRCKSW','FRSSITIM',
  'GAPN','GBYPSIM','GCALLID','GCENTER','GETRSSI','GIMEI','GIMSI',
  'GINCAL','GIPADDR','GLISPORT','GMAIL','GNAME','GNETLOS','GPRVDR',
  'GPWD','GRSSI','GSIMSN','GSIP','GSIPP','GSMG','GSMRSSI','GSMSTT',
  'GSMVER','GSNAME','GSPOLBKP','GSPOLPR','GSPOLSEC','GSPWD','GSUBNET','GTDUPPHN',
  'HTTPBCKP','HTTPHOST','HTTPPASS','HTTPPATH','HTTPPORT','HTTPUSER',
  'IDNS','IGATEWAY','IKACNT','IKARES','IMAC','IMAIL','IMQ','INAME',
  'INETBIOS','INSTPIN','INTP','INTPP','INTPPROT','IPADDR','IPCBYPNT',
  'IPCSTT','IPCVER','IPHONE','IPPOLBKP','IPPOLPR','IPPOLSEC','IRSSITIM',
  'ISMTP','ISMTPP','ISUBNET','IUSRNAM','IUSRPWD',
  'JAMAL','JMTIME','KEYIND','KFALOC','KFSTT','KSWLOCK',
  'LANG','LASTARM','LASTDARM','LBARM','LCDALL','LCDBKL','LEDTEST',
  'LISTENIN','LVLEA','LVLEXEN','LVLSQ','MAINBAT','MDMVER',
  'MSLOCK','MSUNLOCK','MZALOC','NOACNOCL','NOACTV','NOISEL',
  'PANCAL','PBX','PHAL','PHDLY','PICVER','PLAYCHIM','PLDVER',
  'PNLCNF','PNLPORT','PNLSER','PNLSERD','PNLVER','PROG','PROXIND',
  'PSTEST','PUSHBUTN','QARM','QBYP','QLOG','QUICKALC','QUICKSTS',
  'REDIAL','REMRESET','RESETALL','RFIDEF','RFTEST','RFTESTF','RFVER',
  'RINGS','RIPADDR','RMTPHCD','ROUTDIS','RSTON','RSTTECH',
  'SERVMODE','SIAPART','SIATEXT','SIAVTSN','SILNTINS','SIMEXP','SIMPIN',
  'SIMPPC','SIMPPP','SIMPPT','SIXDIG','STSYTLKN','SUBPIN','SV20MIN',
  'SVTIME','SVTO','SWINGER','SWUCMNDG','SWUCMNDI','SWUFILE','SWUPORT',
  'SWUSRVR','SYSLBL','TESTMODE','TIMEZONE','TLOG','TMPRENG','TMPRSND',
  'TMPRTECH','TMPSTT','UDACCID','UDEN','UDPHONE','UDRMTID',
  'VIEWHS','VIEWKO','VMLABEL','VMREOCUR','VOICELAN','VOICETST',
  'VPLABEL','VULABEL','VZLABEL','WRNARM','WZSV',
];

panel.on('SystemInitComplete', async () => {
  console.log('=== FULL PROTOCOL PROBE ===\n');
  const tcp = panel.RiscoComm.TCPSocket;
  const hits = {};

  // Enter prog mode for full access
  await tcp.SendCommand('PROG=1', true);

  // Probe global commands
  console.log('--- Global commands ---');
  for (const cmd of GLOBAL_CMDS) {
    try {
      const r = await tcp.SendCommand(`${cmd}?`, true);
      if (r && !r.startsWith('N') && r !== 'ACK') {
        const val = r.includes('=') ? r.split('=').slice(1).join('=') : r;
        hits[cmd] = val.trim();
        console.log(`  ${cmd} = ${val.trim()}`);
      }
    } catch(e) {}
  }

  // Probe indexed commands with index 1 (or 9 for zones)
  console.log('\n--- Indexed commands (testing with zone 9, partition 1, user 1, output 1) ---');
  for (const cmd of INDEXED_CMDS) {
    // Pick appropriate index based on prefix
    let idx = 1;
    if (cmd.startsWith('Z') || cmd.startsWith('ZONE')) idx = 9;

    try {
      const r = await tcp.SendCommand(`${cmd}${idx}?`, true);
      if (r && !r.startsWith('N') && r !== 'ACK') {
        const val = r.includes('=') ? r.split('=').slice(1).join('=') : r;
        hits[`${cmd}<n>`] = val.trim();
        console.log(`  ${cmd}${idx} = ${val.trim()}`);
      }
    } catch(e) {}
  }

  // Exit prog mode
  try { await tcp.SendCommand('PROG=2', true); } catch(e) {}

  // Save results
  fs.writeFileSync('/Users/yogev/sandbox/risco-control/supported-commands.json',
    JSON.stringify(hits, null, 2));

  console.log(`\n=== FOUND ${Object.keys(hits).length} SUPPORTED COMMANDS ===`);
  process.exit(0);
});

panel.on('PanelCommError', (err) => {
  console.error('Panel error:', err);
});
