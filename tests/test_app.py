import importlib
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


ENVIRONMENT_KEYS = (
    "LOCAPP_BASE",
    "LOCAPP_STORE",
    "LOCAPP_FLAG",
    "LOCAPP_SECRET_FILE",
    "LOCAPP_MEDIA",
    "FRIEND_CODE",
    "OWNER_PASS",
    "LOCAPP_TRUSTED_PROXY_CIDRS",
)


class LocAppServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_environment = {key: os.environ.get(key) for key in ENVIRONMENT_KEYS}
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        os.environ.update({
            "LOCAPP_BASE": str(root),
            "LOCAPP_STORE": str(root / "store"),
            "LOCAPP_FLAG": str(root / "stopped"),
            "LOCAPP_SECRET_FILE": str(root / "secret"),
            "FRIEND_CODE": "654321",
            "OWNER_PASS": "owner-test",
        })
        (root / "static").mkdir()
        (root / "static" / "index.html").write_text("entry", encoding="utf-8")
        (root / "static" / "home.html").write_text("home", encoding="utf-8")
        (root / "static" / "map.html").write_text("map", encoding="utf-8")
        media = root / "media"
        media.mkdir()
        (media / "a-clip.mp4").write_bytes(b"abcdefghij")
        (media / "b-clip.mp4").write_bytes(b"0123456789")
        (media / "notes.txt").write_text("not a video", encoding="utf-8")
        os.utime(media / "a-clip.mp4", (1_700_000_000, 1_700_000_000))
        os.utime(media / "b-clip.mp4", (1_700_000_600, 1_700_000_600))
        sys.modules.pop("app", None)
        cls.app = importlib.import_module("app")
        cls.server = cls.app.create_server("127.0.0.1", 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        try:
            cls.server.shutdown()
            cls.server.server_close()
            cls.thread.join(timeout=2)
        finally:
            sys.modules.pop("app", None)
            for key, value in cls.original_environment.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            cls.temp.cleanup()

    def setUp(self):
        self.server.attempts = {}
        self.server.trusted_proxy_networks = ()
        self.server.auth_decision_hook = None

    def request(self, path, method="GET", payload=None, cookie=None, headers=None):
        headers = dict(headers or {})
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            return urllib.request.urlopen(req)
        except urllib.error.HTTPError as error:
            return error

    def visitor_cookie(self):
        response = self.request("/api/login", "POST", {"code": "654321"})
        return response.headers["Set-Cookie"].split(";", 1)[0]

    def test_public_root_and_protected_map(self):
        self.assertEqual(self.request("/").status, 200)
        self.assertEqual(self.request("/map").geturl(), self.base + "/")

    def test_root_serves_the_new_homepage_and_legacy_keeps_the_old_one(self):
        root = self.request("/")
        self.assertEqual(root.status, 200)
        self.assertEqual(root.read(), b"home")
        self.assertEqual(root.headers["X-Robots-Tag"], "noindex, nofollow, noarchive")

        legacy = self.request("/legacy")
        self.assertEqual(legacy.status, 200)
        self.assertEqual(legacy.read(), b"entry")

        new_alias = self.request("/new")
        self.assertEqual(new_alias.status, 200)
        self.assertEqual(new_alias.read(), b"home")

    def test_new_homepage_route_serves_the_redesign_and_stays_unindexed(self):
        response = self.request("/new")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.read(), b"home")
        self.assertEqual(response.headers["X-Robots-Tag"], "noindex, nofollow, noarchive")

    def test_login_cookie_unlocks_state_and_map(self):
        response = self.request("/api/login", "POST", {"code": "654321"})
        cookie = response.headers["Set-Cookie"].split(";", 1)[0]
        self.assertIn("loc_auth=", cookie)
        self.assertEqual(self.request("/api/state", cookie=cookie).status, 200)
        self.assertEqual(self.request("/map", cookie=cookie).status, 200)

    def test_five_failures_activate_rate_limit(self):
        for _ in range(5):
            self.assertEqual(self.request("/api/login", "POST", {"code": "000000"}).status, 403)
        self.assertEqual(self.request("/api/login", "POST", {"code": "000000"}).status, 429)

    def test_untrusted_forwarded_for_cannot_change_the_rate_limit_bucket(self):
        self.server.trusted_proxy_networks = ()
        for index in range(5):
            response = self.request(
                "/api/login",
                "POST",
                {"code": "000000"},
                headers={"X-Forwarded-For": f"198.51.100.{index + 1}"},
            )
            self.assertEqual(response.status, 403)
        response = self.request(
            "/api/login",
            "POST",
            {"code": "000000"},
            headers={"X-Forwarded-For": "203.0.113.99"},
        )
        self.assertEqual(response.status, 429)

    def test_trusted_proxy_chain_uses_the_first_untrusted_hop_from_the_right(self):
        self.server.trusted_proxy_networks = self.app.parse_trusted_proxy_cidrs(
            "127.0.0.0/8, 10.0.0.0/8"
        )
        for index in range(5):
            response = self.request(
                "/api/login",
                "POST",
                {"code": "000000"},
                headers={
                    "X-Forwarded-For": f"203.0.113.{index + 1}, 198.51.100.44, 10.2.3.4"
                },
            )
            self.assertEqual(response.status, 403)
        response = self.request(
            "/api/login",
            "POST",
            {"code": "000000"},
            headers={"X-Forwarded-For": "192.0.2.8, 198.51.100.44, 10.9.8.7"},
        )
        self.assertEqual(response.status, 429)

    def test_successful_login_clears_prior_failures_for_the_effective_ip(self):
        for _ in range(4):
            self.assertEqual(self.request("/api/login", "POST", {"code": "000000"}).status, 403)
        self.assertEqual(self.request("/api/login", "POST", {"code": "654321"}).status, 200)
        self.assertEqual(self.request("/api/login", "POST", {"code": "000000"}).status, 403)
        self.assertEqual(self.request("/api/login", "POST", {"code": "000000"}).status, 403)

    def test_visitor_success_does_not_clear_owner_failures(self):
        for _ in range(4):
            self.assertEqual(
                self.request("/api/owner_login", "POST", {"pass": "wrong"}).status,
                403,
            )
        self.assertEqual(self.request("/api/login", "POST", {"code": "654321"}).status, 200)
        self.assertEqual(
            self.request("/api/owner_login", "POST", {"pass": "wrong"}).status,
            403,
        )
        self.assertEqual(
            self.request("/api/owner_login", "POST", {"pass": "owner-test"}).status,
            429,
        )
        self.assertEqual(self.request("/api/login", "POST", {"code": "000000"}).status, 403)

    def test_owner_success_does_not_clear_visitor_failures(self):
        for _ in range(4):
            self.assertEqual(self.request("/api/login", "POST", {"code": "000000"}).status, 403)
        self.assertEqual(
            self.request("/api/owner_login", "POST", {"pass": "owner-test"}).status,
            200,
        )
        self.assertEqual(self.request("/api/login", "POST", {"code": "000000"}).status, 403)
        self.assertEqual(self.request("/api/login", "POST", {"code": "654321"}).status, 429)
        self.assertEqual(
            self.request("/api/owner_login", "POST", {"pass": "wrong"}).status,
            403,
        )

    def test_owner_success_clears_only_the_owner_realm(self):
        for _ in range(4):
            self.assertEqual(
                self.request("/api/owner_login", "POST", {"pass": "wrong"}).status,
                403,
            )
        self.assertEqual(
            self.request("/api/owner_login", "POST", {"pass": "owner-test"}).status,
            200,
        )
        self.assertEqual(
            self.request("/api/owner_login", "POST", {"pass": "wrong"}).status,
            403,
        )
        self.assertEqual(
            self.request("/api/owner_login", "POST", {"pass": "wrong"}).status,
            403,
        )

    def test_concurrent_correct_request_cannot_pass_after_five_failures_lock_the_realm(self):
        correct_waiting = threading.Event()
        failures_recorded = threading.Event()
        failure_count = 0
        counter_lock = threading.Lock()

        def auth_hook(phase, realm, candidate, outcome):
            nonlocal failure_count
            if phase == "before_lock" and realm == "visitor" and candidate == "654321":
                correct_waiting.set()
                failures_recorded.wait(timeout=2)
            if phase == "after_decision" and realm == "visitor" and outcome == "failure":
                with counter_lock:
                    failure_count += 1
                    if failure_count == 5:
                        failures_recorded.set()

        self.server.auth_decision_hook = auth_hook
        try:
            with ThreadPoolExecutor(max_workers=6) as executor:
                correct = executor.submit(
                    self.request,
                    "/api/login",
                    "POST",
                    {"code": "654321"},
                )
                correct_waiting.wait(timeout=0.2)
                failures = [
                    executor.submit(
                        self.request,
                        "/api/login",
                        "POST",
                        {"code": "000000"},
                    )
                    for _ in range(5)
                ]
                self.assertEqual([future.result().status for future in failures], [403] * 5)
                self.assertEqual(correct.result().status, 429)
        finally:
            self.server.auth_decision_hook = None

    def test_robots_disallows_all_crawlers(self):
        response = self.request("/robots.txt")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.read().decode("utf-8"), "User-agent: *\nDisallow: /\n")

    def test_public_html_sends_noindex_header(self):
        response = self.request("/")
        self.assertEqual(response.headers["X-Robots-Tag"], "noindex, nofollow, noarchive")

    def test_authenticated_map_sends_noindex_header(self):
        login = self.request("/api/login", "POST", {"code": "654321"})
        cookie = login.headers["Set-Cookie"].split(";", 1)[0]
        response = self.request("/map", cookie=cookie)
        self.assertEqual(response.headers["X-Robots-Tag"], "noindex, nofollow, noarchive")

    def test_static_javascript_has_javascript_content_type(self):
        static = Path(os.environ["LOCAPP_BASE"]) / "static"
        (static / "sample.js").write_text("window.ok = true;", encoding="utf-8")
        response = self.request("/static/sample.js")
        self.assertIn("application/javascript", response.headers["Content-Type"])

    def test_videos_endpoint_lists_only_videos_newest_first(self):
        response = self.request("/api/videos", cookie=self.visitor_cookie())
        self.assertEqual(response.status, 200)
        data = json.loads(response.read().decode("utf-8"))
        self.assertTrue(data["ok"])
        self.assertEqual([item["name"] for item in data["videos"]], ["b-clip.mp4", "a-clip.mp4"])
        first = data["videos"][0]
        self.assertEqual(first["title"], "b-clip")
        self.assertEqual(first["url"], "/media/b-clip.mp4")
        self.assertEqual(first["type"], "video/mp4")
        self.assertEqual(first["size"], 10)

    def test_videos_endpoint_reports_an_empty_library(self):
        media = Path(os.environ["LOCAPP_BASE"]) / "media"
        empty = Path(os.environ["LOCAPP_BASE"]) / "empty-media"
        empty.mkdir(exist_ok=True)
        original = os.environ.get("LOCAPP_MEDIA")
        os.environ["LOCAPP_MEDIA"] = str(empty)
        self.app.MEDIA = str(empty)
        try:
            data = json.loads(self.request("/api/videos", cookie=self.visitor_cookie()).read().decode("utf-8"))
            self.assertEqual(data["videos"], [])
        finally:
            self.app.MEDIA = str(media)
            if original is None:
                os.environ.pop("LOCAPP_MEDIA", None)
            else:
                os.environ["LOCAPP_MEDIA"] = original

    def test_videos_endpoint_merges_caption_metadata(self):
        media = Path(os.environ["LOCAPP_BASE"]) / "media"
        (media / "captions.json").write_text(
            json.dumps({"b-clip.mp4": {"caption": "2026.10.4，测试文案", "recorded": "2026-10-04 16:40:43"}},
                       ensure_ascii=False),
            encoding="utf-8",
        )
        try:
            data = json.loads(self.request("/api/videos", cookie=self.visitor_cookie()).read().decode("utf-8"))
            first = data["videos"][0]
            self.assertEqual(first["name"], "b-clip.mp4")
            self.assertEqual(first["caption"], "2026.10.4，测试文案")
            self.assertEqual(first["recorded"], "2026-10-04 16:40:43")
        finally:
            (media / "captions.json").unlink(missing_ok=True)

    def test_media_endpoint_serves_full_files_and_byte_ranges(self):
        cookie = self.visitor_cookie()
        full = self.request("/media/a-clip.mp4", cookie=cookie)
        self.assertEqual(full.status, 200)
        self.assertEqual(full.headers["Accept-Ranges"], "bytes")
        self.assertEqual(full.headers["Content-Type"], "video/mp4")
        self.assertEqual(full.read(), b"abcdefghij")

        middle = self.request("/media/a-clip.mp4", cookie=cookie, headers={"Range": "bytes=2-5"})
        self.assertEqual(middle.status, 206)
        self.assertEqual(middle.headers["Content-Range"], "bytes 2-5/10")
        self.assertEqual(middle.read(), b"cdef")

        tail = self.request("/media/a-clip.mp4", cookie=cookie, headers={"Range": "bytes=6-"})
        self.assertEqual(tail.status, 206)
        self.assertEqual(tail.read(), b"ghij")

    def test_media_endpoint_rejects_missing_files_and_traversal(self):
        cookie = self.visitor_cookie()
        self.assertEqual(self.request("/media/missing.mp4", cookie=cookie).status, 404)
        self.assertEqual(self.request("/media/..%2Fsecret", cookie=cookie).status, 404)

    def test_media_head_request_returns_headers_without_a_body(self):
        response = self.request("/media/a-clip.mp4", method="HEAD", cookie=self.visitor_cookie())
        self.assertEqual(response.status, 200)
        self.assertEqual(response.headers["Content-Length"], "10")
        self.assertEqual(response.read(), b"")

    def test_videos_and_media_require_the_visitor_code(self):
        self.assertEqual(self.request("/api/videos").status, 401)
        self.assertEqual(self.request("/media/a-clip.mp4").status, 403)
        self.assertEqual(self.request("/media/a-clip.mp4", method="HEAD").status, 403)


class ZEnvironmentCleanupTest(unittest.TestCase):
    def test_server_fixture_restores_environment_and_unloads_app(self):
        self.assertNotIn("app", sys.modules)
        self.assertEqual(
            {key: os.environ.get(key) for key in ENVIRONMENT_KEYS},
            LocAppServerTest.original_environment,
        )
