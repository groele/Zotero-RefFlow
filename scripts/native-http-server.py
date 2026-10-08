"""Loopback-only fault server for native Zotero HTTP regression tests."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit
from pathlib import Path
from threading import Lock
import json, time

lock = Lock()
hits = {}
active = maximum = 0

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        global active, maximum
        path = urlsplit(self.path).path
        with lock:
            hits[self.path] = hits.get(self.path, 0) + 1
            count = hits[self.path]
            active += 1
            maximum = max(maximum, active)
        try:
            status, headers = 200, {}
            if path == '/slow': time.sleep(1.5)
            if path == '/parallel': time.sleep(.12)
            if path == '/retry' and count < 3: status = 503
            if path == '/limited': status, headers = 429, {'Retry-After': '10'}
            if path == '/missing': status = 404
            if path == '/pdf':
                payload = (Path(__file__).parent.parent / 'tests/native-fixtures/single.pdf').read_bytes()
                headers['Content-Type'] = 'application/pdf'
            else:
                with lock: data = {'path': path, 'count': count, 'hits': dict(hits), 'active': active, 'maximum': maximum}
                payload = json.dumps(data).encode()
                headers['Content-Type'] = 'application/json'
            self.send_response(status)
            for key, value in headers.items(): self.send_header(key, value)
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            try: self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError): pass
        finally:
            with lock: active -= 1

print('RefNexus fault server http://127.0.0.1:18796', flush=True)
ThreadingHTTPServer(('127.0.0.1', 18796), Handler).serve_forever()
