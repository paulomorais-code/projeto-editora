#!/usr/bin/env python3
"""Servidor estático de DESENVOLVIMENTO para o site da Nascente.

Diferença do `python3 -m http.server`: envia `Cache-Control: no-cache` para HTML
e assets, então alterações de código aparecem recarregando a página (F5) — sem
cache heurístico do navegador servindo JS/CSS/HTML antigos.

Uso: python3 backend/scripts/static-server.py   (porta 5500, raiz do projeto)
"""
import http.server
import os

ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "site"
)
PORT = 5500


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):  # log enxuto no stdout
        print(f"[static] {self.address_string()} {format % args}")


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        print(f"[static] site de dev em http://localhost:{PORT} (Cache-Control: no-cache)")
        httpd.serve_forever()
