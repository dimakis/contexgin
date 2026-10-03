"""Exercise the proposal through real nginx and disposable loopback upstreams."""
import argparse, hashlib, hmac, http.client, http.server, json, pathlib, re, socket, subprocess, tempfile, threading, time
HERE = pathlib.Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--nginx', default='nginx')
parser.add_argument('--config', type=pathlib.Path, default=HERE.parents[1] / 'docs/deployment/knowledge-webhook-nginx.conf')
args = parser.parse_args()
NGINX = args.nginx
SECRET = b'offline-fixture-only-secret'
received = []

class Upstream(http.server.BaseHTTPRequestHandler):

    def do_POST(self):
        data = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        record = {'lane': self.server.lane, 'path': self.path, 'body': data, 'signature': self.headers.get('X-Hub-Signature-256'), 'authorization': self.headers.get('Authorization'), 'delivery': self.headers.get('X-GitHub-Delivery')}
        received.append(record)
        valid = hmac.compare_digest(record['signature'] or '', 'sha256=' + hmac.new(SECRET, data, hashlib.sha256).hexdigest())
        self.send_response(202 if valid else 403)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def log_message(self, *args):
        pass

def request(port, method, path, body=b'', signature=None, extra_headers=None):
    headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer offline-never-forward', 'X-GitHub-Delivery': 'offline-delivery'}
    if signature:
        headers['X-Hub-Signature-256'] = signature
    headers.update(extra_headers or {})
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    try:
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        response.read()
        return response.status
    finally:
        conn.close()

def run():
    version = subprocess.run([NGINX, '-v'], capture_output=True, text=True, check=True).stderr.strip()
    upstreams = []
    process = None
    checks = []
    try:
        for lane in ['centaur', 'publisher']:
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
            server.lane = lane
            threading.Thread(target=server.serve_forever, daemon=True).start()
            upstreams.append(server)
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
        with tempfile.TemporaryDirectory(prefix='offline-proxy-') as td:
            base = pathlib.Path(td)
            for name in ['tmp/body', 'tmp/proxy', 'logs']:
                (base / name).mkdir(parents=True, mode=448)
            config = args.config.read_text().replace('127.0.0.1:8644', f'127.0.0.1:{port}').replace('127.0.0.1:8642', f'127.0.0.1:{upstreams[0].server_port}').replace('127.0.0.1:8643', f'127.0.0.1:{upstreams[1].server_port}')
            path = base / 'nginx.conf'
            path.write_text(config)
            command = [NGINX, '-p', str(base) + '/', '-c', str(path)]
            syntax = subprocess.run(command + ['-t'], capture_output=True, text=True, check=True)
            checks.append('nginx syntax validation')
            process = subprocess.Popen(command + ['-g', 'daemon off;'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            deadline = time.monotonic() + 5
            while True:
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=0.2):
                        break
                except OSError:
                    if process.poll() is not None:
                        raise AssertionError('nginx exited before binding')
                    if time.monotonic() > deadline:
                        raise AssertionError('nginx readiness timeout')
                    time.sleep(0.05)
            body = b'{\n  "hello": "raw body unchanged", "number": 1\n}\n'
            signature = 'sha256=' + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
            for target, lane in [('/webhook', 'centaur'), ('/api/publications/github', 'publisher')]:
                before = len(received)
                assert request(port, 'POST', target, body, signature) == 202
                assert len(received) == before + 1
                entry = received[-1]
                assert entry['lane'] == lane and entry['path'] == target
                assert entry['body'] == body and entry['signature'] == signature
                assert entry['authorization'] is None and entry['delivery'] == 'offline-delivery'
                checks.append(f'{lane}: exact route, raw body/signature/delivery preserved, authorization stripped')
                assert request(port, 'POST', target, body, 'sha256=' + '0' * 64) == 403
                checks.append(f'{lane}: invalid signature reaches receiver and is rejected')
            at_limit = b'x' * (1024 * 1024)
            boundary_signature = 'sha256=' + hmac.new(SECRET, at_limit, hashlib.sha256).hexdigest()
            for target in ['/webhook', '/api/publications/github']:
                assert request(port, 'POST', target, at_limit, boundary_signature) == 202, target
                assert received[-1]['body'] == at_limit
                checks.append(f'{target}: body exactly 1 MiB accepted unchanged')
            baseline = len(received)
            for method in ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']:
                for target in ['/webhook', '/api/publications/github']:
                    assert request(port, method, target) == 405, (method, target)
                    checks.append(f'{method} {target} denied')
            for target in ['/', '/api/publications/mgmt', '/api/publications/mgmt/reconcile', '/api/publications/mgmt/retry', '/webhook/', '/webhook?x=1', '/api/publications/github?x=1', '/%77ebhook', '/api/publications/%67ithub', '//webhook', '/x/../webhook', '/api//publications/github', '/api/publications/github/']:
                assert request(port, 'POST', target, body, signature) == 404, target
                checks.append(f'raw target {target} denied')
            assert len(received) == baseline, 'denied request reached upstream'
            for target in ['/webhook', '/api/publications/github']:
                assert request(port, 'POST', target, b'x' * (1024 * 1024 + 1), signature) == 413, target
                checks.append(f'{target}: body over 1 MiB rejected')
            assert len(received) == baseline, 'oversized body reached upstream'
            query_secret = 'offline-query-secret-do-not-log'
            header_secret = 'offline-host-header-secret.invalid'
            for target in ['/webhook', '/api/publications/github']:
                status = request(port, 'POST', target + '?token=' + query_secret, b'x' * (1024 * 1024 + 1), signature, {'Host': header_secret, 'X-Private': header_secret})
                assert status in (404, 413), status
                checks.append(f'{target}: secret-bearing oversized/query request denied')
            assert request(port, 'POST', '/' + query_secret, body, signature, {'Host': header_secret}) == 404
            checks.append('secret-bearing path denied without retaining the raw target')
            for server in upstreams:
                server.shutdown()
                server.server_close()
            upstreams.clear()
            assert request(port, 'POST', '/webhook', body, signature, {'Host': header_secret, 'X-Private': header_secret}) == 502
            checks.append('unavailable upstream returns 502 without retaining secret-bearing diagnostics')
            process.terminate()
            process.wait(timeout=5)
            stderr = process.stderr.read().decode()
            process = None
            access_log = (base / 'logs/access.log').read_text()
            assert all((re.fullmatch('route=(centaur|publisher|rejected) status=[0-9]{3} duration=[0-9.]+', line) for line in access_log.splitlines())), 'access log retained raw request values'
            checks.append('access log contains only fixed route labels and numeric metadata')
            logs = access_log + ((base / 'logs/error.log').read_text() if (base / 'logs/error.log').exists() else '') + stderr
            assert query_secret not in logs, 'query secret leaked through error-path logging'
            assert header_secret not in logs, 'header secret leaked through error-path logging'
            assert 'offline-never-forward' not in logs and 'raw body unchanged' not in logs and (signature not in logs)
            checks.append('proxy logs exclude authorization, body and signature values')
            result = {'nginxVersion': version, 'status': 'pass', 'checkCount': len(checks), 'checks': checks, 'modelCalls': 0, 'publicIngressChanges': 0, 'realUpstreamsContacted': 0}
            print(json.dumps(result, indent=2))
    finally:
        if process is not None:
            process.terminate()
            process.wait(timeout=5)
        for server in upstreams:
            server.shutdown()
            server.server_close()
if __name__ == '__main__':
    run()
