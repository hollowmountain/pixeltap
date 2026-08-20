"""Локальный сервер для разработки.

Обычный `python -m http.server` обрабатывает запросы по одному, и когда
на странице появились десятки снимков, он начал захлёбываться: браузер
открывает несколько соединений сразу, они встают в очередь, и часть
запросов отваливается по таймауту. Здесь тот же сервер, но каждый
запрос идёт в своём потоке.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # В разработке кеш только мешает: правки должны быть видны сразу.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # тишина: интересны только ошибки


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8420
srv = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory='.'))
print(f'сайт на http://localhost:{port}')
srv.serve_forever()
