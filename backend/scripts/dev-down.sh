#!/usr/bin/env bash
# Para os 3 serviços de desenvolvimento.
for padrao in "dist/server.js" "correios-mock.mjs" "static-server.py"; do
  for pid in $(pgrep -f "$padrao" 2>/dev/null); do
    [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null
  done
done
sleep 1
echo "serviços de dev encerrados"
