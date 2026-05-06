#!/bin/bash
cd "$(dirname "$0")"

echo "Clearing ports 8080 and 8081..."
fuser -k 8080/tcp 2>/dev/null && echo "  Freed 8080" || echo "  8080 was free"
fuser -k 8081/tcp 2>/dev/null && echo "  Freed 8081" || echo "  8081 was free"
sleep 1

echo "Starting HapBrowser..."
npm run dev
