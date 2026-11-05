"""Serves the Leyenda website and prints the links to open it.

    python serve.py            (port 5500)
    python serve.py 8080       (another port)

The page sends its images to /api/... on this same server, which passes them on to the backend
(http://localhost:8000). So other people only need the address of this server, and the backend
can stay private (in WSL for instance).
"""
import functools
import http.server
import json
import socket
import sys
import urllib.error
import urllib.request
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
BACKEND = "http://localhost:8000"
SITE = Path(__file__).resolve().parent
MAX_UPLOAD = 11 * 1024 * 1024          # the backend accepts 10 MB per image, plus the form around it


def local_ip():
    # IP of this computer on the network (no data is sent: a UDP "connection" only picks the network card)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return None


def backend_ready():
    try:
        with urllib.request.urlopen(f"{BACKEND}/health", timeout=2) as answer:
            return answer.status == 200
    except OSError:
        return False


class Handler(http.server.SimpleHTTPRequestHandler):
    # Files of the website, and /api/... passed on to the backend

    def log_message(self, format, *args):
        # Only the errors are printed, not one line per file
        if len(args) > 1 and str(args[1]).startswith(("4", "5")):
            super().log_message(format, *args)

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.forward()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self.forward()
        else:
            self.send_error(405)

    def forward(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_UPLOAD:
            return self.reply(413, {"detail": "The image is too big (10 MB max)."})
        body = self.rfile.read(length) if length else None
        request = urllib.request.Request(BACKEND + self.path[len("/api"):], data=body, method=self.command)
        if self.headers.get("Content-Type"):
            request.add_header("Content-Type", self.headers["Content-Type"])
        try:
            with urllib.request.urlopen(request, timeout=120) as answer:
                self.reply(answer.status, answer.read(), answer.headers.get("Content-Type"))
        except urllib.error.HTTPError as error:          # the backend answered with an error (400, 413...)
            self.reply(error.code, error.read(), error.headers.get("Content-Type"))
        except OSError:                                  # the backend is not running
            self.reply(502, {"detail": f"The backend is not reachable at {BACKEND}. Is it running?"})

    def reply(self, status, body, content_type="application/json"):
        if isinstance(body, dict):
            body = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type or "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


handler = functools.partial(Handler, directory=str(SITE))
try:
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler)
except OSError:
    sys.exit(f"Port {PORT} is already in use: the website is probably already running "
             f"(open http://localhost:{PORT}), or start it on another port: python serve.py 5501")

ip = local_ip()
print()
print("  Leyenda website is running")
print(f"  -> On this computer:            http://localhost:{PORT}")
if ip:
    print(f"  -> For others on the same Wi-Fi: http://{ip}:{PORT}")
print()
if backend_ready():
    print(f"  Backend: ready ({BACKEND})")
else:
    print(f"  Backend: NOT reachable at {BACKEND}. Start it in another window:")
    print("     cd backend   then   python -m uvicorn main:app --host 0.0.0.0 --port 8000")
print()
print("  Press Ctrl+C to stop.")
print()

try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\n  Website stopped.")
    server.server_close()
