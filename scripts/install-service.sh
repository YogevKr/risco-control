#!/bin/bash
# Install risco-control as a macOS background service
# Starts automatically on boot, runs silently

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BINARY="${RISCO_BINARY:-$ROOT_DIR/dist/risco-control}"
PLIST="$HOME/Library/LaunchAgents/com.risco.control.plist"

cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.risco.control</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BINARY}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>RISCO_IP</key>
        <string>${RISCO_IP:-127.0.0.1}</string>
        <key>PORT</key>
        <string>3580</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/risco-control.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/risco-control.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST"

echo "Installed! risco-control is now running as a background service."
echo "  URL: http://localhost:3580"
echo "  Log: /tmp/risco-control.log"
echo "  To stop: launchctl unload ~/Library/LaunchAgents/com.risco.control.plist"
