"""Фейковый Organism для теста session.rs: логин, refresh, задачи по cookie."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from http.cookies import SimpleCookie

STATE = {"access": None, "served_expired": False}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def cookies(self):
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return {k: v.value for k, v in c.items()}

    def send(self, code, body, cookies=()):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        for ck in cookies:
            self.send_header("Set-Cookie", ck)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/api/auth/login":
            if body.get("password") != "secret":
                return self.send(401, {"detail": "Неверный email или пароль"})
            STATE["access"] = "a1"
            return self.send(200, {"ok": True}, [
                "access_token=a1; Path=/; HttpOnly; Max-Age=900",
                "refresh_token=r1; Path=/api/auth; HttpOnly; Max-Age=2592000",
            ])
        if self.path == "/api/auth/refresh":
            if self.cookies().get("refresh_token") != "r1":
                return self.send(401, {"detail": "no refresh"})
            STATE["access"] = "a2"
            return self.send(200, {"ok": True}, ["access_token=a2; Path=/; HttpOnly; Max-Age=900"])
        if self.path == "/api/auth/logout":
            STATE["access"] = None
            return self.send(200, {"ok": True}, [
                "access_token=; Path=/; Max-Age=0", "refresh_token=; Path=/api/auth; Max-Age=0"])
        self.send(404, {"detail": "nf"})

    def do_GET(self):
        if self.path.startswith("/api/tasks"):
            tok = self.cookies().get("access_token")
            # первый токен считаем истёкшим, чтобы проверить автоматический refresh
            if tok != "a2" or STATE["access"] != "a2":
                return self.send(401, {"detail": "Not authenticated"})
            return self.send(200, {"rows": [{"short_id": "t1", "title": "x"}], "total": 1})
        self.send(404, {"detail": "nf"})

HTTPServer(("127.0.0.1", 18765), H).serve_forever()
