#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js nije instaliran. Otvaram https://nodejs.org - preuzmi LTS verziju i ponovo pokreni ovaj fajl."
  echo ""
  open "https://nodejs.org/"
  read -n 1 -s -r -p "  Pritisni bilo koji taster za izlaz..."
  exit 1
fi
node server.js
