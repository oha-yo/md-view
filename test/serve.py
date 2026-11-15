# md-view のテスト用サーバー。md-view のフォルダを配り、test/ の下の .json だけは PUT で書ける
# （回帰テストの結果を expected.json に保存するため）。
# 使い方：md-view のフォルダで  python test/serve.py 8790
#         --csp を付けると、公開するときと同じ CSP（deploy/.htaccess に書いたもの）を付けて返す
import http.server
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NO_CACHE = '--cache' not in sys.argv


def read_csp():
    # deploy/.htaccess の CSP をそのまま使う。frame-ancestors だけは外す（回帰テストは md-view を iframe で開くため）
    with open(os.path.join(ROOT, 'deploy', '.htaccess'), encoding='utf-8') as f:
        m = re.search(r'Content-Security-Policy "([^"]+)"', f.read())
    return '; '.join(p.strip() for p in m.group(1).split(';') if not p.strip().startswith('frame-ancestors'))


CSP = read_csp() if '--csp' in sys.argv else None


class Handler(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1 で接続を使い回す（HTTP/1.0 で返事のたびに閉じると、Windows ではブラウザの読み込みがときどき途中で切れるため）
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # 直したファイルを必ず読ませるため、ブラウザに毎回確かめさせる（変わっていなければ 304 で、キャッシュを使う）
    def end_headers(self):
        if NO_CACHE:
            self.send_header('Cache-Control', 'no-cache')
        if CSP and not self.path.startswith('/test/'):  # テストのページそのものには付けない
            self.send_header('Content-Security-Policy', CSP)
        super().end_headers()

    def do_PUT(self):
        path = self.path.split('?')[0]
        if not (path.startswith('/test/') and path.endswith('.json') and '..' not in path):
            self.send_error(403)
            return
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        with open(os.path.join(ROOT, path.lstrip('/')), 'wb') as f:
            f.write(body)
        self.send_response(204)
        self.end_headers()


class Server(http.server.ThreadingHTTPServer):
    # 同時にたくさん来ても切らないように、待ち行列を長くする（標準は 5 で、Windows では超えた分の接続が切られる）
    request_queue_size = 64


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    port = int(args[0]) if args else 8790
    Server(('127.0.0.1', port), Handler).serve_forever()
