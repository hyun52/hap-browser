#!/usr/bin/env python3
"""
serve.py — HapBrowser production server
Serves the dist/ folder produced by npm run build.

Usage:
  python serve.py [port] [directory]
  python serve.py 8080 dist

For development, use npm run dev instead.
"""
import http.server
import socketserver
import sys
import os
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
DIR = sys.argv[2] if len(sys.argv) > 2 else 'dist'

# If dist/ is missing, use current folder (where data/ lives)
if not os.path.isdir(DIR):
    DIR = '.'

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', DIR))

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # CORS for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, format, *args):
        status = args[1] if len(args) > 1 else ''
        if status != '200':
            print(f"  ⚠ {status}  {args[0].split()[1] if args else ''}")

print()
print("━" * 48)
print("  🌾  HapBrowser v2.0 — Production Server")
print("━" * 48)
print(f"  URL  →  http://localhost:{PORT}/")
print(f"  Dir  →  {os.getcwd()}")
print()
print("  Stop with: Ctrl+C")
print("━" * 48)
print()

webbrowser.open(f"http://localhost:{PORT}/")

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
