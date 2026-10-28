#!/usr/bin/env bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js nije instaliran. Instaliraj Node.js 18.17+ (https://nodejs.org) pa pokreni ponovo."
  exit 1
fi
exec node server.js "$@"
