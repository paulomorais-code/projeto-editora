#!/usr/bin/env bash
# Sobe os 3 serviços de desenvolvimento: API + simulador Correios + site estático.
# Uso: bash backend/scripts/dev-up.sh
set -e
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
BACK="$RAIZ/backend"

cd "$BACK"
[ -f dist/server.js ] || { echo " rode 'npm run build' antes"; exit 1; }

setsid nohup node scripts/correios-mock.mjs > correios-mock.log 2>&1 < /dev/null &
CORREIOS_BASE_URL=http://127.0.0.1:4500 CORREIOS_CLIENT_ID=mock-id CORREIOS_CLIENT_SECRET=mock-secret \
  setsid nohup node dist/server.js > server.log 2>&1 < /dev/null &
setsid nohup python3 scripts/static-server.py > "$RAIZ/static-server.log" 2>&1 < /dev/null &

sleep 2.5
curl -s --max-time 3 http://localhost:3333/health && echo " ← API :3333"
curl -s --max-time 3 -o /dev/null -w "site :5500 → %{http_code}\n" http://localhost:5500/index.html
echo "painel: http://localhost:3333/admin/admin.html"
