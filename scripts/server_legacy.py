#!/usr/bin/env python3
"""
server.py — HapBrowser local server
Usage: python server.py [port]  (default port: 8080)
"""
import http.server
import socketserver
import sys
import os
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

# Change to script location (where index.html lives)
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Only log 404s; normal requests are silent
        if args[1] != '200':
            print(f"  {'✓' if args[1]=='200' else '⚠'} {args[1]}  {args[0].split()[1]}")

print()
print("━" * 48)
print("  🌾  HapBrowser — Local Server")
print("━" * 48)
print(f"  URL  →  http://localhost:{PORT}/")
print(f"  Dir  →  {os.getcwd()}")
print()
print("  Press Ctrl+C to stop.")
print("━" * 48)
print()

# Auto-open browser (comment out to disable)
webbrowser.open(f"http://localhost:{PORT}/")

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\n  Server stopped.")
