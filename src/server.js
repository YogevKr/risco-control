// Entry point: wires the panel connection, the command layer and the HTTP app.
// Everything testable lives in app.js, panel-commands.js and panel-controller.js.

const { createApp } = require('./app');
const { createCommandLayer } = require('./panel-commands');
const { createPanelController } = require('./panel-controller');
const { getPanelRuntime, isLoopbackHost } = require('./panel-runtime');
const { loadCommandCatalog } = require('./command-catalog');
const { startMqttBridge } = require('./mqtt');

const ROOT_DIR = process.cwd();

function main() {
  const runtime = getPanelRuntime();

  if (!isLoopbackHost(runtime.host) && !runtime.apiToken) {
    console.error(
      `Refusing to listen on ${runtime.host}: the API has no authentication. ` +
      'Set RISCO_API_TOKEN (or "apiToken" in risco-config.json) to expose it beyond this machine, ' +
      'or bind to 127.0.0.1.'
    );
    process.exit(1);
  }

  const controller = createPanelController(runtime);
  const commands = createCommandLayer({
    transport: controller.transport,
    onWrite: (info) => controller.noteWrite(info),
    retries: runtime.commandRetries,
  });
  const catalog = loadCommandCatalog(ROOT_DIR);
  const app = createApp({
    commands,
    controller,
    catalog,
    runtime,
    rootDir: ROOT_DIR,
    // A config change restarts the server so every module reads the new runtime.
    onConfigChange: async () => {
      console.log('Panel config changed; reconnecting with the new settings.');
      const next = getPanelRuntime();
      Object.assign(runtime.panelOptions, next.panelOptions);
      await controller.reconnect();
    },
  });

  const server = app.listen(runtime.port, runtime.host, () => {
    console.log('\n===========================================');
    console.log('  RISCO CONTROL CENTER');
    console.log(`  http://${runtime.host}:${runtime.port}`);
    console.log(`  config: ${runtime.configPath || '(none; defaults + env)'}  log level: ${runtime.logLevel}`);
    if (runtime.discoverCode) console.log('  WARNING: access-code discovery is ON (RISCO_DISCOVER_CODE)');
    console.log('===========================================\n');
  });
  server.on('error', (err) => {
    console.error(`Cannot listen on ${runtime.host}:${runtime.port}: ${err.message}`);
    process.exit(1);
  });

  const mqtt = startMqttBridge({ runtime, trigger: app.locals.trigger });

  controller.connect().catch((err) => console.error(`Panel connect failed: ${err.message}`));

  const shutdown = async (signal) => {
    console.log(`\n${signal} received; closing.`);
    server.close();
    if (mqtt) mqtt.stop();
    await controller.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main();
}

module.exports = { main };
