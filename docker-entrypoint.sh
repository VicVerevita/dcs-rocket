#!/bin/sh

set -e

echo "========================================"
echo " DCS Rocket"
echo "========================================"

if [ "${DEPLOY_COMMANDS_ON_START:-true}" = "true" ]; then
    echo "[startup] Deploying Discord commands..."
    node scripts/deploy-commands.js
    echo "[startup] Discord commands deployed."
else
    echo "[startup] Command deployment disabled."
fi

echo "[startup] Starting Discord bot..."

exec node src/index.js