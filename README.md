# Risco Control Panel

Full web-based Risco alarm panel control. Connects directly to your Risco alarm panel over LAN — no cloud required.

Supports: LightSYS, LightSYS 2, ProSYS Plus, Agility, WiComm, GT Plus.

## Quick Start

```bash
# Clone and install
git clone <repo>
cd risco-control
npm install

# Configure and run
RISCO_IP=192.168.x.x RISCO_PASSWORD=<remote access code> npm start
```

Open http://localhost:3580

The server logs the panel address, whether the TCP port answered, and when the
handshake completed. `GET /api/health` returns the same facts as JSON.

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `RISCO_IP` | `127.0.0.1` | Panel IP address |
| `RISCO_PORT` | `1000` | Panel TCP port |
| `RISCO_PASSWORD` | `5678` | Remote access code |
| `RISCO_PANEL_ID` | `0001` | Panel ID |
| `RISCO_PANEL_TYPE` | `LightSys` | Panel type: `LightSys`, `ProsysPlus`, `Agility`, `WiComm`, `WiCommPro`, `GTPlus` |
| `HOST` | `127.0.0.1` | Address the web server binds to. Anything but loopback needs `RISCO_API_TOKEN` |
| `PORT` | `3580` | Web UI port |
| `RISCO_API_TOKEN` | *(none)* | Token every `/api/*` call must send (`Authorization: Bearer …` or `X-API-Token`). Required when `HOST` is not loopback |
| `RISCO_ALLOWED_HOSTS` | *(none)* | Extra `Host` header names the server accepts, comma separated (DNS names; IP literals always pass) |
| `RISCO_ALLOWED_ORIGINS` | *(none)* | Extra browser origins for CORS |
| `RISCO_LOG_LEVEL` | `error` | Library log level: `error`, `warn`, `info`, `verbose`, `debug` |
| `RISCO_DEBUG` | *(off)* | `1` = same as `RISCO_LOG_LEVEL=debug` |
| `RISCO_DISCOVER_CODE` | `0` | `1` lets the library brute-force the access code (0–999999 tries against a live panel). Off by default |
| `RISCO_ZONES_CACHE_MS` | `30000` | How long `/api/zones` serves cached data. Any write or `?fresh=1` drops the cache |
| `RISCO_COMMAND_RETRIES` | `2` | How many times a command with no reply is sent again (each attempt waits the library's 5 s timeout) |
| `RISCO_TRIGGER_DELAY` | `30` | Default seconds between `/api/trigger` and the panel action |
| `RISCO_MQTT_URL` | *(none)* | MQTT broker URL, for example `mqtt://homeassistant:1883`. Empty disables the bridge |
| `RISCO_MQTT_TOPIC` | `risco/control` | MQTT base topic. Commands arrive on `<topic>/set` |
| `RISCO_MQTT_USERNAME` | *(none)* | MQTT user name |
| `RISCO_MQTT_PASSWORD` | *(none)* | MQTT password |
| `RISCO_CONFIG_PATH` | *(auto)* | Explicit path of `risco-config.json` |

The same keys can live in `risco-config.json` (`panelIp`, `panelPort`, `panelPassword`,
`panelId`, `panelType`, `host`, `port`, `apiToken`, `allowedHosts`, `allowedOrigins`,
`logLevel`, `discoverCode`, `zonesCacheMs`, `triggerDelay`, `mqttUrl`, `mqttTopic`,
`mqttUsername`, `mqttPassword`). Environment variables win over the file.
The file is written with owner-only permissions (`0600`) because it holds the access
code and installer PINs. From source it lives next to `package.json`; in the `.app`
bundle and the compiled binary it lives next to the executable.

## Network requirements

- The server must reach the panel's remote port (default 1000) by plain TCP. Same L2
  network is simplest; across VLANs the firewall must allow the server's address to
  the panel. A tunnel whose far end is blocked looks "connected" locally and then the
  handshake times out with no reply.
- The handshake waits 10 seconds after the TCP connect before it sends `RMT`
  (the Risco CS software does the same). Expect "ready" about 15–25 s after start.
- The IP module accepts several TCP sessions at once; a second client does not
  push the first one off.
- The server binds to `127.0.0.1` by default. To expose it on the LAN set `HOST` and
  `RISCO_API_TOKEN`; the UI asks for the token on its connect screen.

## Things to know

- **Labels** (zones, users, outputs, …) hold at most 16 characters. The panel cuts
  longer values silently, so the API rejects them with HTTP 400 and reads every
  indexed label back after a write (`labelReadBack`, `labelVerified` in the result).
- **Zone numbering**: the panel and this API count zones from 1. Home Assistant's
  cloud integration counts from 0, so its "zone 9" is panel zone 10.
- **Lost replies**: the panel drops about one reply in ten, mostly right after the
  handshake. A command with no reply is sent again (`RISCO_COMMAND_RETRIES`, default
  2), except output activation and `/api/raw`. When every attempt fails the API
  returns HTTP 504 with `code: "timeout"`.
- **Batch reads**: `ZTYPE`, `ZLBL` and `ZSTT` answer the `CMD*min:max?` form; the
  panel answers `N05` for the others, so those are read per zone. `/api/zones` stops
  at the zone count the panel type allows (32 on a LightSYS RP432).
- **Programming mode**: writes run inside `PROG=1 … PROG=2`. `GET /api/health`
  reports `configChangedAt` when the panel announced a config change; `POST
  /api/reconnect` reconnects and clears it.
- **Errors** come back as `{ "error": "...", "code": "..." }`; `503 not_connected`
  until the handshake is done, `400` for bad input, `504 timeout` for lost replies.

## Docker

```bash
docker build -t risco-control .
docker run -d --network host \
  -e RISCO_IP=192.168.x.x \
  -e RISCO_PASSWORD=<remote access code> \
  risco-control
```

Or with docker-compose:

```bash
# Edit docker-compose.yml with your panel IP and access code
docker compose up -d
```

## Features

- 5,987-command catalog plus live panel support status
- Real-time zone status, battery, signal strength
- Arm/Disarm/Stay from browser
- PIR/MW/Shock sensitivity control (Z2W commands)
- Full system diagnostics (`npm run doctor`)
- Edit all settings: users, zones, outputs, follow-me, cloud, network, GSM, schedules, and more
- Signal bars for wireless zones and GSM
- Dead sensor detection with last-seen timestamps
- `GET /api/health` with connection state, last probe, last error and command stats

## Home Assistant trigger (delayed alarm)

The panel has no direct "sound the bell" command. It raises an alarm only when a
zone trips on an armed partition. The trigger endpoint therefore runs a panel
action after a delay; the panel's own exit and entry delays then apply.

Actions:

| Action | Panel command | Use |
|--------|---------------|-----|
| `arm` | `ARM=<partition>` | Real alarm. An open delay zone alarms after the entry delay |
| `stay` | `STAY=<partition>` | Arm and stay inside |
| `disarm` | `DISARM=<partition>` | Stop the alarm, cancel the plan |
| `output` | `ACTUO<output>` | Pulse a PGM relay (needs a wired bell trigger) |
| `siren` | `SNTEST` | Short wireless-siren test only |
| `none` | none | Only record the event |

### HTTP

```bash
# Arm partition 1 after 30 s. Cancel it if someone disarms first.
curl -X POST http://risco.local:3580/api/trigger \
  -H 'Content-Type: application/json' \
  -d '{"action":"arm","partition":1,"delay":30,"name":"front door"}'

curl -X POST http://risco.local:3580/api/trigger/cancel -d '{"reason":"disarmed"}'
curl http://risco.local:3580/api/trigger          # pending plan and last result
```

Field reference: `action`, `partition` (1–4), `output` (1–32), `delay` seconds
(default `RISCO_TRIGGER_DELAY`), `restoreAfter` seconds to undo an `arm`/`stay`,
and `name` for the status. A new call replaces a pending plan.

Home Assistant `configuration.yaml`:

```yaml
rest_command:
  risco_trigger:
    url: http://risco.local:3580/api/trigger
    method: POST
    headers:
      Authorization: !secret risco_api_token
    payload: '{"action":"arm","partition":1,"delay":30,"name":"{{ name }}"}'
    content_type: application/json
  risco_cancel:
    url: http://risco.local:3580/api/trigger/cancel
    method: POST
    headers:
      Authorization: !secret risco_api_token
    payload: '{"reason":"cancel"}'
    content_type: application/json
```

Automation: arm 30 s after the door opens, and cancel if the door closes again.

```yaml
automation:
  - alias: Door open delayed alarm
    triggers:
      - trigger: state
        entity_id: binary_sensor.front_door
        to: "on"
    actions:
      - action: rest_command.risco_trigger
        data:
          name: front door
  - alias: Door closed cancels the alarm plan
    triggers:
      - trigger: state
        entity_id: binary_sensor.front_door
        to: "off"
    actions:
      - action: rest_command.risco_cancel
```

### MQTT

Set `RISCO_MQTT_URL`. Publish to `<topic>/set`:

```text
disarm                     -> immediate DISARM=1
trigger                    -> arm after RISCO_TRIGGER_DELAY
trigger 45                 -> arm after 45 s
{"action":"arm","delay":30,"partition":1,"name":"front door"}
cancel
```

The bridge answers on `<topic>/result` and mirrors the plan on `<topic>/state`
(retained). Add `<topic>/set` to a Home Assistant `mqtt.publish` action:

```yaml
actions:
  - action: mqtt.publish
    data:
      topic: risco/control/set
      payload: '{"action":"arm","delay":30,"name":"front door"}'
```

## System Doctor

```bash
npm run doctor
```

Runs a full diagnostic scan: battery, signal, dead zones, default passwords, missing notifications, and more.

## Tests

```bash
npm test
```

`test/app.test.js` and `test/panel-commands.test.js` run the HTTP routes and the
command layer against an in-memory fake panel; no hardware is needed.

## Repository Layout

- `src/server.js` - entry point: wires the panel connection, the command layer and the HTTP app
- `src/app.js` - HTTP API, security middleware and the web UI route
- `src/panel-controller.js` - panel connection lifecycle, reachability probe, health state
- `src/panel-commands.js` - serialised command queue, retry, programming mode, label validation
- `src/trigger.js` - delayed panel trigger used by the HTTP routes and the MQTT bridge
- `src/mqtt.js` - optional MQTT bridge (`RISCO_MQTT_URL`)
- `src/panel-runtime.js` - config file and environment handling
- `src/ui.html` - browser UI
- `test/` - Node test suite
- `data/` - generated command catalog and command inputs
- `scripts/` - build and install helpers
- `tools/probes/` - exploratory panel/protocol tools
- `dist/` - compiled binary (build output, not tracked)
