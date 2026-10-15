#!/usr/bin/env python3
# 我的位置 - 小型网站服务
# 依赖: 仅 Python 标准库
import json
import os
import secrets
import hmac
import time
import hashlib
import ipaddress
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote

BASE = os.environ.get("LOCAPP_BASE", "/opt/locapp")
STATIC = os.path.join(BASE, "static")
STORE = os.environ.get("LOCAPP_STORE", "/opt/owntracks/store")
FLAG = os.environ.get("LOCAPP_FLAG", "/opt/owntracks/owner/stopped")
SECRET_FILE = os.environ.get("LOCAPP_SECRET_FILE", "/opt/locapp/secret")
MEDIA = os.environ.get("LOCAPP_MEDIA", os.path.join(BASE, "media"))

# 允许放进 media/ 目录的视频类型
VIDEO_TYPES = {
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
}

FRIEND_CODE = os.environ.get("FRIEND_CODE", "123456")
OWNER_PASS = os.environ.get("OWNER_PASS", "owner123")

# 登录有效期：7 天（超过后需要重新输入访问码）
SESSION_SECONDS = 7 * 24 * 3600


def parse_trusted_proxy_cidrs(raw):
    networks = []
    for value in raw.split(","):
        value = value.strip()
        if not value:
            continue
        try:
            networks.append(ipaddress.ip_network(value, strict=False))
        except ValueError:
            continue
    return tuple(networks)


def load_secret():
    if os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    s = secrets.token_hex(16)
    with open(SECRET_FILE, "w", encoding="utf-8") as f:
        f.write(s)
    os.chmod(SECRET_FILE, 0o600)
    return s


SECRET = load_secret()


def sign(value):
    return hmac.new(SECRET.encode(), value.encode(), hashlib.sha256).hexdigest()


def make_cookie(role):
    payload = role + "|" + str(int(time.time()) + SESSION_SECONDS)
    return payload + "." + sign(payload)


def check_cookie(raw):
    if not raw:
        return None
    parts = raw.split(".")
    if len(parts) != 2:
        return None
    payload, sig = parts
    if not hmac.compare_digest(sign(payload), sig):
        return None
    role, exp = payload.split("|")
    if int(exp) < time.time():
        return None
    return role


def read_last_location():
    base = os.path.join(STORE, "last")
    if not os.path.isdir(base):
        return None
    best = None
    try:
        for user in os.listdir(base):
            udir = os.path.join(base, user)
            if not os.path.isdir(udir):
                continue
            for dev in os.listdir(udir):
                p = os.path.join(udir, dev)
                files = []
                if os.path.isdir(p):
                    for name in os.listdir(p):
                        if name.endswith(".json"):
                            files.append(os.path.join(p, name))
                elif p.endswith(".json"):
                    files.append(p)
                for fp in files:
                    try:
                        with open(fp, "r", encoding="utf-8") as f:
                            data = json.load(f)
                    except Exception:
                        continue
                    if best is None or (data.get("tst") or 0) > (best.get("tst") or 0):
                        best = data
    except Exception:
        pass
    return best


def list_videos():
    """列出 media/ 目录里的视频（附带 captions.json 里的文字与拍摄时间），最新的排在最前面。"""
    if not os.path.isdir(MEDIA):
        return []
    captions = {}
    caption_file = os.path.join(MEDIA, "captions.json")
    if os.path.isfile(caption_file):
        try:
            with open(caption_file, "r", encoding="utf-8") as f:
                captions = json.load(f) or {}
        except Exception:
            captions = {}
    items = []
    for name in os.listdir(MEDIA):
        if name.startswith("."):
            continue
        fp = os.path.join(MEDIA, name)
        if not os.path.isfile(fp):
            continue
        ctype = VIDEO_TYPES.get(os.path.splitext(name)[1].lower())
        if not ctype:
            continue
        try:
            stat = os.stat(fp)
        except OSError:
            continue
        meta = captions.get(name) or {}
        items.append({
            "name": name,
            "title": os.path.splitext(name)[0],
            "size": stat.st_size,
            "mtime": int(stat.st_mtime),
            "url": "/media/" + quote(name),
            "type": ctype,
            "caption": (meta.get("caption") or "").strip(),
            "recorded": (meta.get("recorded") or "").strip(),
        })
    # 按"拍摄时间"倒序（最新拍的在前）；没记录拍摄时间的按上传时间排在后面
    items.sort(key=lambda item: (item.get("recorded") or "", item["mtime"], item["name"]), reverse=True)
    return items


def stopped_flag():
    if not os.path.exists(FLAG):
        return False
    try:
        with open(FLAG, "r", encoding="utf-8") as f:
            return f.read().strip() == "1"
    except Exception:
        return False


def set_flag(value):
    os.makedirs(os.path.dirname(FLAG), exist_ok=True)
    with open(FLAG, "w", encoding="utf-8") as f:
        f.write("1" if value else "0")


class Handler(BaseHTTPRequestHandler):
    server_version = "LocApp/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        if headers:
            for k, v in headers.items():
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj, headers=None):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), headers=headers)

    def _static(self, path, extra_headers=None):
        rel = path.lstrip("/")
        if ".." in rel:
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        fp = os.path.join(STATIC, rel)
        if not os.path.isfile(fp):
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".png": "image/png",
        }.get(os.path.splitext(fp)[1], "application/octet-stream")
        with open(fp, "rb") as f:
            body = f.read()
        self._send(200, body, ctype, headers=extra_headers)

    def _media(self, name, head_only=False):
        """按块发送视频文件，支持 Range 请求（手机浏览器拖动进度条需要）。"""
        if not name or ".." in name or name.startswith("/"):
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        fp = os.path.join(MEDIA, name)
        if not os.path.isfile(fp):
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        ctype = VIDEO_TYPES.get(os.path.splitext(fp)[1].lower(), "application/octet-stream")
        size = os.path.getsize(fp)
        start, end = 0, max(size - 1, 0)
        status = 200
        range_header = self.headers.get("Range", "").strip()
        if range_header.startswith("bytes=") and size > 0:
            spec = range_header[len("bytes="):].split(",")[0].strip()
            first, _, last = spec.partition("-")
            try:
                if first:
                    start = int(first)
                    end = int(last) if last else size - 1
                else:
                    start = max(size - int(last), 0)
                    end = size - 1
            except ValueError:
                start, end = 0, size - 1
            if start >= size or start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            end = min(end, size - 1)
            status = 206

        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        if head_only:
            return
        with open(fp, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def _client_ip(self):
        peer_text = self.client_address[0]
        try:
            peer = ipaddress.ip_address(peer_text)
        except ValueError:
            return peer_text

        trusted_networks = getattr(self.server, "trusted_proxy_networks", ())

        def is_trusted(address):
            return any(
                address.version == network.version and address in network
                for network in trusted_networks
            )

        if not is_trusted(peer):
            return str(peer)

        forwarded = self.headers.get("X-Forwarded-For", "")
        if not forwarded:
            return str(peer)
        try:
            chain = [ipaddress.ip_address(value.strip()) for value in forwarded.split(",")]
        except ValueError:
            return str(peer)
        if not chain:
            return str(peer)

        effective = peer
        for address in reversed(chain):
            if not is_trusted(effective):
                break
            effective = address
        return str(effective)

    def _authenticate(self, realm, candidate, expected):
        ip = self._client_ip()
        key = (ip, realm)
        candidate_text = candidate if isinstance(candidate, str) else ""
        hook = getattr(self.server, "auth_decision_hook", None)
        if hook:
            hook("before_lock", realm, candidate_text, None)

        with self.server.attempts_lock:
            now = time.time()
            rec = self.server.attempts.get(key)
            if rec and rec["until"] and rec["until"] <= now:
                self.server.attempts.pop(key, None)
                rec = None
            if rec and rec["until"] > now:
                outcome = "locked"
                retry = int(rec["until"] - now) + 1
            elif hmac.compare_digest(candidate_text, expected):
                self.server.attempts.pop(key, None)
                outcome = "success"
                retry = 0
            else:
                if not rec:
                    rec = {"count": 0, "until": 0}
                rec["count"] += 1
                if rec["count"] >= 5:
                    rec["count"] = 0
                    rec["until"] = now + 60
                self.server.attempts[key] = rec
                outcome = "failure"
                retry = 0
            if hook:
                hook("after_decision", realm, candidate_text, outcome)
        return outcome, retry

    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 1024:
                return {}
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    def _cookie(self):
        raw = self.headers.get("Cookie", "")
        for part in raw.split(";"):
            k, _, v = part.strip().partition("=")
            if k == "loc_auth":
                return check_cookie(v)
        return None

    def do_GET(self):
        path = self.path.split("?")[0]
        noindex = {"X-Robots-Tag": "noindex, nofollow, noarchive"}
        if path in ("/", "/new"):
            # 新版首页（2026-10-09 起作为默认入口；/new 保留以免旧链接失效）
            self._static("home.html", extra_headers=noindex)
        elif path == "/legacy":
            # 旧版首页，保留以便随时回退
            self._static("index.html", extra_headers=noindex)
        elif path == "/robots.txt":
            self._send(200, b"User-agent: *\nDisallow: /\n", "text/plain; charset=utf-8")
        elif path == "/map":
            if self._cookie():
                self._static("map.html", extra_headers=noindex)
            else:
                self.send_response(302)
                self.send_header("Location", "/")
                self.end_headers()
        elif path == "/owner":
            if self._cookie() == "owner":
                self._static("owner.html")
            else:
                self._static("owner.html")  # 页面内自行判断是否已登录
        elif path == "/api/state":
            role = self._cookie()
            if not role:
                self._json(401, {"ok": False, "error": "unauthorized"})
                return
            loc = read_last_location()
            state = {
                "ok": True,
                "role": role,
                "stopped": stopped_flag(),
                "has_location": loc is not None,
            }
            if loc:
                state.update({
                    "lat": loc.get("lat"),
                    "lon": loc.get("lon"),
                    "tst": loc.get("tst"),
                    "batt": loc.get("batt"),
                })
            self._json(200, state)
        elif path == "/api/videos":
            if not self._cookie():
                self._json(401, {"ok": False, "error": "unauthorized"})
                return
            self._json(200, {"ok": True, "videos": list_videos()})
        elif path.startswith("/media/"):
            if not self._cookie():
                self._send(403, b"forbidden", "text/plain; charset=utf-8")
                return
            self._media(unquote(path[len("/media/"):]))
        elif path == "/api/logout":
            self._send(200, b"ok", "text/plain; charset=utf-8",
                       headers={"Set-Cookie": "loc_auth=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"})
        elif path.startswith("/static/"):
            self._static(path[len("/static/"):])
        else:
            self._send(404, b"not found", "text/plain; charset=utf-8")

    def do_HEAD(self):
        path = self.path.split("?")[0]
        if path.startswith("/media/"):
            if not self._cookie():
                self._send(403, b"forbidden", "text/plain; charset=utf-8")
                return
            self._media(unquote(path[len("/media/"):]), head_only=True)
        elif path.startswith("/static/"):
            self._static(path[len("/static/"):])
        else:
            self._send(404, b"not found", "text/plain; charset=utf-8")

    def do_POST(self):
        path = self.path.split("?")[0]
        data = self._read_json()
        if path == "/api/login":
            outcome, retry = self._authenticate("visitor", data.get("code"), FRIEND_CODE)
            if outcome == "success":
                self._json(200, {"ok": True},
                           headers={"Set-Cookie": "loc_auth=" + make_cookie("friend") +
                                                   "; Max-Age=" + str(SESSION_SECONDS) +
                                                   "; Path=/; HttpOnly; SameSite=Lax"})
            elif outcome == "locked":
                self._json(429, {"ok": False, "error": "尝试次数过多，请稍后再试", "retry": retry})
            else:
                self._json(403, {"ok": False, "error": "访问码错误"})
        elif path == "/api/owner_login":
            outcome, retry = self._authenticate("owner", data.get("pass"), OWNER_PASS)
            if outcome == "success":
                self._json(200, {"ok": True},
                           headers={"Set-Cookie": "loc_auth=" + make_cookie("owner") +
                                                   "; Max-Age=" + str(SESSION_SECONDS) +
                                                   "; Path=/; HttpOnly; SameSite=Lax"})
            elif outcome == "locked":
                self._json(429, {"ok": False, "error": "尝试次数过多，请稍后再试", "retry": retry})
            else:
                self._json(403, {"ok": False, "error": "密码错误"})
        elif path == "/api/owner_action":
            if self._cookie() != "owner":
                self._json(403, {"ok": False, "error": "unauthorized"})
                return
            action = data.get("action")
            if action == "stop":
                set_flag(True)
                self._json(200, {"ok": True, "stopped": True})
            elif action == "start":
                set_flag(False)
                self._json(200, {"ok": True, "stopped": False})
            else:
                self._json(400, {"ok": False, "error": "bad action"})
        else:
            self._json(404, {"ok": False, "error": "not found"})


def create_server(host="127.0.0.1", port=8000):
    server = ThreadingHTTPServer((host, port), Handler)
    server.attempts = {}
    server.attempts_lock = threading.Lock()
    server.auth_decision_hook = None
    server.trusted_proxy_networks = parse_trusted_proxy_cidrs(
        os.environ.get("LOCAPP_TRUSTED_PROXY_CIDRS", "")
    )
    return server


def main():
    server = create_server()
    print("locapp listening on 127.0.0.1:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
