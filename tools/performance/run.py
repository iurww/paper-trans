#!/usr/bin/env python3
"""Benchmark the real Linux release binary/AppImage in an isolated HOME.

Requires a visible desktop session, Node.js, a C compiler and WebKitGTK.
The preload hook only injects the audit script; it does not change rendering.
"""
import argparse
import http.server
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading
import time

parser = argparse.ArgumentParser()
parser.add_argument('application', type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--timeout', type=int, default=120)
parser.add_argument('--check', choices=['desktop', 'software'])
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
records = []
done = threading.Event()

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        record = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        records.append(record)
        print(json.dumps(record, ensure_ascii=False), flush=True)
        self.send_response(200)
        self.end_headers()
        if record['type'] in ('done', 'error'):
            done.set()
    def log_message(self, *args):
        pass

with tempfile.TemporaryDirectory(prefix='paperlens-performance-') as temporary:
    work = Path(temporary)
    home = work / 'home'
    home.mkdir()
    subprocess.run(['node', str(root / 'tools/performance/fixture.mjs'), str(home)], check=True)
    hook = work / 'inject.so'
    subprocess.run(['cc', '-shared', '-fPIC', '-O2', '-Wall', '-Wextra', str(root / 'tools/performance/inject.c'), '-ldl', '-o', str(hook)], check=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    script = work / 'audit.js'
    script.write_text((root / 'tools/performance/audit.js').read_text().replace('__REPORT_URL__', f'http://127.0.0.1:{server.server_port}/metrics'))
    env = os.environ.copy()
    env.update(HOME=str(home), XDG_DATA_HOME=str(home / '.local/share'), XDG_CACHE_HOME=str(home / '.cache'),
               XDG_CONFIG_HOME=str(home / '.config'), LD_PRELOAD=str(hook), PAPERLENS_AUDIT_SCRIPT=str(script))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    log = args.output.with_suffix('.stderr.log')
    with log.open('w') as stream:
        process = subprocess.Popen([str(args.application.resolve())], env=env, stdout=stream, stderr=stream, start_new_session=True)
        deadline = time.monotonic() + args.timeout
        while not done.wait(.2) and time.monotonic() < deadline and process.poll() is None:
            pass
        if not done.is_set():
            records.append({'type': 'error', 'message': f'Audit did not finish; application exit={process.poll()}; see {log}'})
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=10)
        except ProcessLookupError:
            pass
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
    server.shutdown()
    args.output.write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
    if any(record['type'] == 'error' for record in records):
        raise SystemExit(1)
    if args.check:
        subprocess.run(['node', str(root / 'tools/performance/check.mjs'), str(args.output), args.check], check=True)
