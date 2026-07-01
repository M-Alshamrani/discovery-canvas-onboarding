#!/usr/bin/env bash
# Dell Discovery Canvas — macOS / Linux local runner

set -e

# Check that Python 3 is installed
if ! command -v python3 >/dev/null 2>&1; then
  echo ""
  echo "  [!] python3 is not installed on this machine."
  echo ""
  echo "  macOS:  brew install python    (or download from https://python.org/downloads)"
  echo "  Linux:  sudo apt install python3  (or your distro's equivalent)"
  echo ""
  echo "  Once installed, run this script again."
  echo ""
  exit 1
fi

# cd to the folder this script lives in
cd "$(dirname "$0")"

echo ""
echo "  ============================================================"
echo "    Dell Discovery Canvas"
echo "    Local server starting on http://localhost:8000"
echo "    Your browser will open in a moment."
echo ""
echo "    To stop: press Ctrl+C."
echo "  ============================================================"
echo ""

# Open the default browser after a 2-second delay
(sleep 2 && {
  if command -v open >/dev/null 2>&1; then
    open http://localhost:8000           # macOS
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:8000       # Linux with desktop
  fi
}) &

# Run the bundled static server (forces correct ES-module MIME types;
# a bare `python3 -m http.server` can serve .js as text/plain on some
# systems, which browsers reject for module scripts).
python3 serve.py 8000
