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
RISCO_IP=192.168.x.x npm start
```

Open http://localhost:3580

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `RISCO_IP` | `127.0.0.1` | Panel IP address |
| `RISCO_PORT` | `1000` | Panel TCP port |
| `RISCO_PASSWORD` | `5678` | Remote access code |
| `RISCO_PANEL_ID` | `0001` | Panel ID |
| `RISCO_PANEL_TYPE` | `LightSys` | Panel type: `LightSys`, `ProsysPlus`, `Agility`, `WiComm`, `WiCommPro`, `GTPlus` |
| `PORT` | `3580` | Web UI port |

## Docker

```bash
docker build -t risco-control .
docker run -d --network host \
  -e RISCO_IP=192.168.x.x \
  risco-control
```

Or with docker-compose:

```bash
# Edit docker-compose.yml with your panel IP
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

## System Doctor

```bash
npm run doctor
```

Runs a full diagnostic scan: battery, signal, dead zones, default passwords, missing notifications, and more.

## Repository Layout

- `src/` - local control server, diagnostics, runtime helpers, and browser UI
- `test/` - Node test suite
- `data/` - generated command catalog and command inputs
- `scripts/` - build and install helpers
- `tools/probes/` - exploratory panel/protocol tools
- `dist/` - standalone compiled binary
