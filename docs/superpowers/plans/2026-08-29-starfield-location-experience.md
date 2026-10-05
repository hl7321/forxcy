# Starfield Location Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the confirmed “星野坐标” dual-entry letter, password, and protected map experience without changing the existing location-reporting contract.

**Architecture:** Keep the Python standard-library HTTP server and Leaflet map. Turn the public root into a small client-side state machine, move editable copy and pure state rules into independent JavaScript modules, keep `/map` server-protected, and extract page-specific CSS/JavaScript so each responsibility can be tested separately.

**Tech Stack:** Python 3 standard library, HTML5, CSS, vanilla JavaScript, Node.js built-in `node:test`, Leaflet 1.x assets already stored in `static/`.

**Spec:** `docs/superpowers/specs/2026-08-29-starfield-location-experience-design.md`

## Global Constraints

- Preserve the existing location store reader, WGS-84 → GCJ-02 conversion, 10-second state polling, trail, battery display, stop/resume state, owner authentication, and owner controls.
- Keep the visitor password, owner password, and signing secret server-side; no password or derived password may appear in public files.
- The letter is public. Only the location route and location state API require visitor authentication.
- Do not request visitor geolocation, add analytics, send visit notifications, or add third-party tracking.
- `letter_seen` is the only new browser-persisted value and must remain local to `localStorage`.
- The letter body and transition text are intentionally empty in the first release and must render no empty section or filler copy.
- Use the exact confirmed Chinese copy from the spec.
- Use `#172333 → #111D2A → #0C1622` for the night field, `#F2EFE9` for primary text, `#9FADB8` for secondary text, `#E8AD87` for the single warm anchor, and approximately `#DFE3E1` for the map ground.
- Mobile is primary down to 320px; body and editable inputs are at least 16px; tap targets are approximately 44px; text must survive 200% zoom.
- Honor `prefers-reduced-motion`; remove long-distance movement and parallax while keeping meaningful feedback.
- Do not redesign `static/owner.html`; only repair the existing JavaScript string syntax defect and preserve its behavior.
- Do not add a package manager, framework, animation dependency, font download, image background, or build pipeline.
- Git safety: the current `git rev-parse --show-toplevel` resolves to `/Users/hl`, not this project. Never commit to that parent repository. Commit steps below run only after the project has a safe independent Git root; otherwise record the checkpoint and leave changes uncommitted.

## Planned File Structure

| File | Responsibility |
|---|---|
| `app.py` | Environment-configurable paths, HTTP routes, authentication, throttling, static delivery, robots policy, server factory |
| `static/index.html` | Semantic dual-entry, letter, transition, and password views |
| `static/content.js` | Public editable Chinese content only |
| `static/experience-core.js` | Pure entry-priority, hint, state, and freshness functions usable by browser and Node tests |
| `static/experience.js` | DOM state controller, letter persistence, motion sequencing, login submission |
| `static/theme.css` | Shared visual tokens, typography, focus, reduced-motion base rules |
| `static/experience.css` | Entry, letter, transition, password, star field, responsive layout |
| `static/map.html` | Protected map semantic shell |
| `static/map.css` | Map layout, overlays, warm marker, responsive states |
| `static/map.js` | Existing coordinate/map behavior plus stale, tile-error, and retry states |
| `static/leaflet.css`, `static/leaflet.js` | Existing vendored Leaflet assets; unchanged |
| `static/owner.html` | Existing owner UI; one syntax repair only |
| `tests/test_app.py` | Server route, auth, cookie, rate limit, robots, and static content tests |
| `tests/test_static_contracts.py` | HTML, privacy, copy, script order, semantics, and CSS contract tests |
| `tests/experience-core.test.js` | Pure state and content behavior tests |
| `tests/fixtures/store/last/test-user/test-device/location.json` | Deterministic location fixture |

---

### Task 1: Establish a Safe, Testable Server Baseline

**Files:**
- Modify: `app.py:9-19, 280-285`
- Modify: `static/owner.html:103-106`
- Create: `tests/test_app.py`
- Create: `tests/fixtures/store/last/test-user/test-device/location.json`

**Interfaces:**
- Consumes: Current `Handler`, `make_cookie(role)`, `/api/login`, `/api/state`, `/map`, and owner page behavior.
- Produces: `create_server(host: str = "127.0.0.1", port: int = 8000) -> ThreadingHTTPServer`; environment overrides `LOCAPP_BASE`, `LOCAPP_STORE`, `LOCAPP_FLAG`, and `LOCAPP_SECRET_FILE`.

- [ ] **Step 1: Add a failing server integration test**

Create `tests/test_app.py` with a temporary static directory, import-safe environment, an ephemeral server, and these baseline assertions:

```python
import importlib
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path


class LocAppServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
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
        (root / "static" / "map.html").write_text("map", encoding="utf-8")
        sys.modules.pop("app", None)
        cls.app = importlib.import_module("app")
        cls.server = cls.app.create_server("127.0.0.1", 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.temp.cleanup()

    def setUp(self):
        self.server.attempts = {}

    def request(self, path, method="GET", payload=None, cookie=None):
        headers = {}
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

    def test_public_root_and_protected_map(self):
        self.assertEqual(self.request("/").status, 200)
        self.assertEqual(self.request("/map").geturl(), self.base + "/")

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
```

- [ ] **Step 2: Run the baseline test and confirm the missing factory fails**

Run:

```bash
python3 -m unittest discover -s tests -p 'test_app.py' -v
```

Expected: FAIL because importing `app.py` still targets `/opt/locapp` and `create_server` does not exist.

- [ ] **Step 3: Make filesystem paths configurable and add the server factory**

Replace the fixed path block and bottom-level server construction in `app.py`:

```python
BASE = os.environ.get("LOCAPP_BASE", "/opt/locapp")
STATIC = os.path.join(BASE, "static")
STORE = os.environ.get("LOCAPP_STORE", "/opt/owntracks/store")
FLAG = os.environ.get("LOCAPP_FLAG", "/opt/owntracks/owner/stopped")
SECRET_FILE = os.environ.get("LOCAPP_SECRET_FILE", "/opt/locapp/secret")


def create_server(host="127.0.0.1", port=8000):
    server = ThreadingHTTPServer((host, port), Handler)
    server.attempts = {}
    return server


def main():
    server = create_server()
    print("locapp listening on 127.0.0.1:8000")
    server.serve_forever()
```

- [ ] **Step 4: Repair the existing owner-page JavaScript syntax defect**

Change only the stopped description expression in `static/owner.html`:

```javascript
$("desc").textContent = stopped
  ? "朋友打开网站会看到“已停止共享”，点下方按钮可恢复"
  : "朋友打开网站即可看到你的实时位置";
```

- [ ] **Step 5: Add a deterministic location fixture and run the tests**

Create `tests/fixtures/store/last/test-user/test-device/location.json`:

```json
{"lat": 31.2304, "lon": 121.4737, "tst": 1787932800, "batt": 82}
```

Run:

```bash
python3 -m unittest discover -s tests -p 'test_app.py' -v
sed -n '/<script>/,/<\/script>/{ /<script>/d; /<\/script>/d; p; }' static/owner.html | node --check -
```

Expected: Python tests PASS and Node reports no JavaScript syntax error.

- [ ] **Step 6: Commit the baseline checkpoint when Git is safe**

```bash
test "$(git rev-parse --show-toplevel)" = "$PWD"
git add app.py static/owner.html tests/test_app.py tests/fixtures/store/last/test-user/test-device/location.json
git commit -m "test: establish locapp server baseline"
```

Expected: the first command must succeed before any `git add`. If it fails, do not run the commit commands.

---

### Task 2: Add Editable Content and Pure Experience Rules

**Files:**
- Create: `static/content.js`
- Create: `static/experience-core.js`
- Create: `tests/experience-core.test.js`

**Interfaces:**
- Consumes: Exact copy and state requirements in the design spec.
- Produces: `window.LOCAPP_CONTENT` / CommonJS content object; `window.LocExperience` / CommonJS API with `entryPriority(letterSeen)`, `failureHint(attemptCount, content)`, `locationFreshness(timestamp, nowSeconds)`, and `nextView(current, event)`.

- [ ] **Step 1: Write failing Node tests for copy and pure rules**

Create `tests/experience-core.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const content = require("../static/content.js");
const core = require("../static/experience-core.js");

test("confirmed copy is exact and empty sections stay empty", () => {
  assert.deepEqual(content.letter.opening, ["你好，这是一封示例信。", "欢迎来到这个新的锚点。"]);
  assert.deepEqual(content.letter.body, []);
  assert.deepEqual(content.letter.closing, [
    "这里只会展示站主的位置，不会获取访客的定位，所以站主看不到你在哪里。",
    "访客打开这个页面时，站主不会收到任何通知。",
    "这个站点主要用于演示单向位置分享。",
  ]);
  assert.deepEqual(content.transition.lines, []);
  assert.equal(content.password.initialHint, "访问码是 6 位数字，请向站主索取。");
  assert.equal(content.password.success, "验证通过，正在进入地图。");
});

test("letter_seen changes emphasis without removing an entry", () => {
  assert.deepEqual(core.entryPriority(false), { primary: "letter", secondary: "location" });
  assert.deepEqual(core.entryPriority(true), { primary: "location", secondary: "letter" });
});

test("password hints stop escalating after the third failure", () => {
  assert.equal(core.failureHint(1, content), "访问码不正确，请再试一次。");
  assert.equal(core.failureHint(2, content), "访问码还是不对，注意位数。");
  assert.equal(core.failureHint(3, content), "提示：访问码是 6 位数字。");
  assert.equal(core.failureHint(9, content), core.failureHint(3, content));
});

test("location becomes stale after five minutes", () => {
  assert.equal(core.locationFreshness(700, 999), "fresh");
  assert.equal(core.locationFreshness(699, 1000), "stale");
  assert.equal(core.locationFreshness(null, 1000), "missing");
});

test("only valid view transitions are accepted", () => {
  assert.equal(core.nextView("entry", "OPEN_LETTER"), "letter");
  assert.equal(core.nextView("letter", "CONTINUE"), "transition");
  assert.equal(core.nextView("entry", "OPEN_LOCATION"), "password-idle");
  assert.equal(core.nextView("password-idle", "SUBMIT"), "password-submitting");
  assert.equal(core.nextView("password-submitting", "FAIL"), "password-error");
  assert.equal(core.nextView("password-submitting", "SUCCESS"), "password-success");
});
```

- [ ] **Step 2: Run the tests and confirm missing modules fail**

Run:

```bash
node --test tests/experience-core.test.js
```

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 3: Create the public content module with exact confirmed copy**

Create `static/content.js` as a browser/CommonJS module. Its factory must return this shape:

```javascript
(function (root, factory) {
  const content = factory();
  if (typeof module === "object" && module.exports) module.exports = content;
  else root.LOCAPP_CONTENT = content;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return Object.freeze({
    entry: Object.freeze({
      greeting: "一个新的锚点",
      letterTitle: "读一封信",
      letterDescription: "有几句话，想安静地留在这里。",
      locationTitle: "查看位置",
      locationDescription: "直接看看我现在在哪里。",
    }),
    letter: Object.freeze({
      opening: Object.freeze(["你好，这是一封示例信。", "欢迎来到这个新的锚点。"]),
      body: Object.freeze([]),
      closing: Object.freeze([
        "这里只会展示站主的位置，不会获取访客的定位，所以站主看不到你在哪里。",
        "访客打开这个页面时，站主不会收到任何通知。",
        "这个站点主要用于演示单向位置分享。",
      ]),
    }),
    transition: Object.freeze({ lines: Object.freeze([]) }),
    password: Object.freeze({
      initialHint: "访问码是 6 位数字，请向站主索取。",
      failureHints: Object.freeze([
        "访问码不正确，请再试一次。",
        "访问码还是不对，注意位数。",
        "提示：访问码是 6 位数字。",
      ]),
      success: "验证通过，正在进入地图。",
    }),
  });
});
```

- [ ] **Step 4: Implement pure state helpers**

Create `static/experience-core.js` with the same browser/CommonJS wrapper and these exact exports:

```javascript
function entryPriority(letterSeen) {
  return letterSeen
    ? { primary: "location", secondary: "letter" }
    : { primary: "letter", secondary: "location" };
}

function failureHint(attemptCount, content) {
  const index = Math.max(0, Math.min(attemptCount, 3) - 1);
  return content.password.failureHints[index];
}

function locationFreshness(timestamp, nowSeconds) {
  if (timestamp == null) return "missing";
  return nowSeconds - timestamp > 300 ? "stale" : "fresh";
}

const transitions = Object.freeze({
  entry: Object.freeze({ OPEN_LETTER: "letter", OPEN_LOCATION: "password-idle" }),
  letter: Object.freeze({ BACK: "entry", CONTINUE: "transition" }),
  transition: Object.freeze({ COMPLETE: "password-idle" }),
  "password-idle": Object.freeze({ BACK: "entry", SUBMIT: "password-submitting" }),
  "password-error": Object.freeze({ BACK: "entry", SUBMIT: "password-submitting" }),
  "password-submitting": Object.freeze({ FAIL: "password-error", SUCCESS: "password-success" }),
  "password-success": Object.freeze({}),
});

function nextView(current, event) {
  const next = transitions[current] && transitions[current][event];
  if (!next) throw new Error(`Invalid transition: ${current} -> ${event}`);
  return next;
}

return Object.freeze({ entryPriority, failureHint, locationFreshness, nextView });
```

- [ ] **Step 5: Run tests and commit when safe**

```bash
node --test tests/experience-core.test.js
test "$(git rev-parse --show-toplevel)" = "$PWD"
git add static/content.js static/experience-core.js tests/experience-core.test.js
git commit -m "feat: add starfield experience content model"
```

Expected: Node tests PASS. Stop before `git add` if the Git-root check fails.

---

### Task 3: Build the Semantic Visitor Shell and Visual System

**Files:**
- Modify: `static/index.html:1-145`
- Create: `static/theme.css`
- Create: `static/experience.css`
- Create: `tests/test_static_contracts.py`

**Interfaces:**
- Consumes: `window.LOCAPP_CONTENT`, `window.LocExperience`, and the view names from Task 2.
- Produces: DOM views `view-entry`, `view-letter`, `view-transition`, `view-password`; controls `open-letter`, `open-location`, `letter-back`, `letter-continue`, `password-back`; password group `otp`; live output `password-feedback`.

- [ ] **Step 1: Write failing semantic and privacy contract tests**

Create `tests/test_static_contracts.py`:

```python
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StaticContractTest(unittest.TestCase):
    def read(self, relative):
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_entry_has_four_named_views_and_native_controls(self):
        html = self.read("static/index.html")
        for view_id in ("view-entry", "view-letter", "view-transition", "view-password"):
            self.assertIn(f'id="{view_id}"', html)
        for control_id in ("open-letter", "open-location", "letter-back", "letter-continue", "password-back"):
            self.assertRegex(html, rf'<(?:button|a)[^>]+id="{control_id}"')

    def test_entry_declares_privacy_and_script_order(self):
        html = self.read("static/index.html")
        self.assertIn('name="robots" content="noindex,nofollow,noarchive"', html)
        self.assertNotIn("navigator.geolocation", html)
        order = [html.index(name) for name in ("content.js", "experience-core.js", "experience.js")]
        self.assertEqual(order, sorted(order))

    def test_confirmed_visual_tokens_exist(self):
        css = self.read("static/theme.css")
        for color in ("#172333", "#111D2A", "#0C1622", "#F2EFE9", "#9FADB8", "#E8AD87"):
            self.assertIn(color.lower(), css.lower())

    def test_empty_content_is_not_replaced_with_filler(self):
        content = self.read("static/content.js")
        self.assertIn("body: Object.freeze([])", content)
        self.assertIn("lines: Object.freeze([])", content)
        self.assertNotRegex(content, re.compile(r"lorem|待填写|以后再写", re.I))
```

- [ ] **Step 2: Run static tests and confirm the existing page fails**

Run:

```bash
python3 -m unittest tests.test_static_contracts -v
```

Expected: FAIL because the current page only contains the password card and inline styles.

- [ ] **Step 3: Replace `static/index.html` with the semantic four-view shell**

Use this structure, preserving six individually labeled numeric inputs:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0C1622">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>一个新的锚点</title>
  <link rel="stylesheet" href="/static/theme.css">
  <link rel="stylesheet" href="/static/experience.css">
</head>
<body>
  <div class="star-field" aria-hidden="true"></div>
  <main class="experience-shell" id="experience-shell">
    <section class="experience-view" id="view-entry" aria-labelledby="entry-title">
      <p class="eyebrow" id="entry-title"></p>
      <span class="anchor-point" aria-hidden="true"></span>
      <div class="entry-actions">
        <button id="open-letter" type="button"><span data-copy="letter-title"></span><small data-copy="letter-description"></small></button>
        <button id="open-location" type="button"><span data-copy="location-title"></span><small data-copy="location-description"></small></button>
      </div>
    </section>
    <article class="experience-view" id="view-letter" aria-labelledby="letter-title" hidden>
      <button id="letter-back" type="button">返回</button>
      <h1 class="sr-only" id="letter-title">一封信</h1>
      <div id="letter-opening"></div>
      <div id="letter-body"></div>
      <div id="letter-closing"></div>
      <button id="letter-continue" type="button">继续前往位置</button>
    </article>
    <section class="experience-view" id="view-transition" aria-label="正在前往位置" hidden>
      <div id="transition-copy"></div>
      <span class="traveling-anchor" aria-hidden="true"></span>
    </section>
    <section class="experience-view" id="view-password" aria-labelledby="password-title" hidden>
      <button id="password-back" type="button">返回</button>
      <h1 id="password-title">查看位置</h1>
      <p id="password-hint"></p>
      <div class="otp" id="otp" role="group" aria-label="六位访问码"></div>
      <p id="password-feedback" aria-live="polite"></p>
    </section>
    <noscript><p class="noscript-note">请启用 JavaScript 以输入访问码并查看位置。</p></noscript>
  </main>
  <script src="/static/content.js"></script>
  <script src="/static/experience-core.js"></script>
  <script src="/static/experience.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create shared theme tokens and accessibility foundations**

Create `static/theme.css` with exact tokens and global rules:

```css
:root {
  --night-1: #172333;
  --night-2: #111D2A;
  --night-3: #0C1622;
  --ink: #F2EFE9;
  --muted: #9FADB8;
  --anchor: #E8AD87;
  --map-ground: #DFE3E1;
  --focus: rgba(232, 173, 135, 0.42);
  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --serif: "Songti SC", "STSong", "Noto Serif CJK SC", serif;
}
* { box-sizing: border-box; }
html { color-scheme: dark; background: var(--night-3); }
body { margin: 0; min-width: 320px; min-height: 100%; color: var(--ink); font-family: var(--sans); }
button, input { font: inherit; }
button { min-height: 44px; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 4px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
[hidden] { display: none !important; }
```

- [ ] **Step 5: Create the “星野坐标” layout without generic card chrome**

Create `static/experience.css`. The implementation must include:

```css
body {
  background: linear-gradient(155deg, var(--night-1) 0%, var(--night-2) 54%, var(--night-3) 100%);
  overflow-x: hidden;
}
.experience-shell { position: relative; z-index: 1; width: min(100%, 680px); margin-inline: auto; min-height: 100dvh; padding: max(28px, env(safe-area-inset-top)) 22px max(28px, env(safe-area-inset-bottom)); }
.experience-view { min-height: calc(100dvh - 56px); }
.star-field { position: fixed; inset: 0; pointer-events: none; opacity: 0.54; background-image: radial-gradient(circle, rgba(242,239,233,.6) 0 1px, transparent 1.5px); background-size: 83px 97px; }
.anchor-point, .traveling-anchor { display: block; width: 12px; height: 12px; border-radius: 50%; background: var(--anchor); box-shadow: 0 0 0 8px rgba(232,173,135,.08), 0 0 30px rgba(232,173,135,.32); }
.entry-actions { display: grid; gap: 14px; margin-top: clamp(44px, 12vh, 120px); }
.entry-actions button { color: var(--ink); text-align: start; background: transparent; border: 0; border-block-end: 1px solid rgba(242,239,233,.14); padding: 18px 4px; }
.entry-actions button[data-priority="primary"] { color: var(--anchor); }
.entry-actions small { display: block; margin-top: 8px; color: var(--muted); font-size: 14px; }
#view-letter { font-family: var(--serif); max-width: 34em; margin-inline: auto; line-height: 1.95; font-size: clamp(16px, 2.5vw, 19px); }
.otp { display: flex; justify-content: center; gap: clamp(6px, 2vw, 12px); }
.otp input { width: clamp(40px, 12vw, 48px); height: 56px; font-size: 24px; color: var(--ink); text-align: center; background: rgba(255,255,255,.04); border: 1px solid rgba(242,239,233,.16); border-radius: 12px; }
@media (max-width: 359px) { .experience-shell { padding-inline: 14px; } .otp { gap: 5px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }
```

Add sparse secondary star layers with pseudo-elements; do not add a galaxy image, purple field, neon glow, glass card, or continuous bright twinkle.

- [ ] **Step 6: Run the tests and commit when safe**

```bash
python3 -m unittest tests.test_static_contracts -v
test "$(git rev-parse --show-toplevel)" = "$PWD"
git add static/index.html static/theme.css static/experience.css tests/test_static_contracts.py
git commit -m "feat: build semantic starfield visitor shell"
```

Expected: static contracts PASS. Stop before `git add` if the Git-root check fails.

---

### Task 4: Implement the Dual-Entry State Machine, Letter, Password, and Motion

**Files:**
- Create: `static/experience.js`
- Modify: `static/experience.css`
- Modify: `tests/experience-core.test.js`
- Modify: `tests/test_static_contracts.py`

**Interfaces:**
- Consumes: `LOCAPP_CONTENT`; `LocExperience.entryPriority`, `failureHint`, and `nextView`; `/api/state`; `/api/login`.
- Produces: `renderContent()`, `showState(nextState, options)`, `move(event, options)`, `checkExistingSession() -> Promise<boolean>`, `runLetterTransition() -> Promise<void>`, `submitCode() -> Promise<void>`.

- [ ] **Step 1: Extend failing tests for invalid transitions and privacy persistence**

Add to `tests/experience-core.test.js`:

```javascript
test("invalid state transitions throw instead of drifting", () => {
  assert.throws(() => core.nextView("entry", "SUCCESS"), /Invalid transition/);
});
```

Add to `tests/test_static_contracts.py`:

```python
def test_experience_storage_and_network_boundaries(self):
    script = self.read("static/experience.js")
    self.assertIn('localStorage.setItem("letter_seen", "true")', script)
    self.assertNotIn("navigator.geolocation", script)
    self.assertNotRegex(script, re.compile(r"analytics|telemetry|beacon", re.I))
    self.assertIn('fetch("/api/login"', script)
    self.assertIn('fetch("/api/state"', script)
```

- [ ] **Step 2: Run tests and verify the missing controller fails**

```bash
node --test tests/experience-core.test.js
python3 -m unittest tests.test_static_contracts -v
```

Expected: Node rules pass; static contracts FAIL because `static/experience.js` does not exist.

- [ ] **Step 3: Render configured content and six OTP inputs**

Start `static/experience.js` with strict DOM ownership and no HTML interpolation for user-editable copy:

```javascript
(() => {
  "use strict";
  const content = window.LOCAPP_CONTENT;
  const core = window.LocExperience;
  const byId = id => document.getElementById(id);
  const views = ["entry", "letter", "transition", "password"];
  const stateToView = Object.freeze({
    entry: "entry",
    letter: "letter",
    transition: "transition",
    "password-idle": "password",
    "password-submitting": "password",
    "password-error": "password",
    "password-success": "password",
  });
  let currentState = "entry";
  let failureCount = 0;
  let lockedUntil = 0;

  function appendParagraphs(target, lines) {
    target.replaceChildren(...lines.map(line => {
      const p = document.createElement("p");
      p.textContent = line;
      return p;
    }));
    target.hidden = lines.length === 0;
  }

  function renderContent() {
    byId("entry-title").textContent = content.entry.greeting;
    document.querySelector('[data-copy="letter-title"]').textContent = content.entry.letterTitle;
    document.querySelector('[data-copy="letter-description"]').textContent = content.entry.letterDescription;
    document.querySelector('[data-copy="location-title"]').textContent = content.entry.locationTitle;
    document.querySelector('[data-copy="location-description"]').textContent = content.entry.locationDescription;
    appendParagraphs(byId("letter-opening"), content.letter.opening);
    appendParagraphs(byId("letter-body"), content.letter.body);
    appendParagraphs(byId("letter-closing"), content.letter.closing);
    appendParagraphs(byId("transition-copy"), content.transition.lines);
    byId("password-hint").textContent = content.password.initialHint;
  }

  function buildOtp() {
    const boxes = Array.from({ length: 6 }, (_, index) => {
      const input = document.createElement("input");
      input.type = "password";
      input.inputMode = "numeric";
      input.pattern = "[0-9]*";
      input.maxLength = 1;
      input.autocomplete = "one-time-code";
      input.setAttribute("aria-label", `访问码第 ${index + 1} 位`);
      return input;
    });
    byId("otp").replaceChildren(...boxes);
    return boxes;
  }
```

- [ ] **Step 4: Implement view switching and entry priority**

Continue with:

```javascript
function applyEntryPriority() {
  const seen = localStorage.getItem("letter_seen") === "true";
  const priority = core.entryPriority(seen);
  byId("open-letter").dataset.priority = priority.primary === "letter" ? "primary" : "secondary";
  byId("open-location").dataset.priority = priority.primary === "location" ? "primary" : "secondary";
}

function showState(nextState, { focus = true } = {}) {
  const nextView = stateToView[nextState];
  views.forEach(name => { byId(`view-${name}`).hidden = name !== nextView; });
  currentState = nextState;
  if (!focus) return;
  const target = byId(`view-${nextView}`).querySelector("button, input, [href], h1");
  if (target) target.focus({ preventScroll: true });
}

function move(event, options) {
  showState(core.nextView(currentState, event), options);
}

async function checkExistingSession() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function openLocation({ fromLetter = false } = {}) {
  const authenticated = await checkExistingSession();
  if (fromLetter) localStorage.setItem("letter_seen", "true");
  if (fromLetter) {
    move("CONTINUE", { focus: false });
    await runLetterTransition();
  }
  if (authenticated) window.location.assign("/map");
  else if (fromLetter) move("COMPLETE");
  else move("OPEN_LOCATION");
}
```

- [ ] **Step 5: Implement the authored transition with a reduced-motion path**

Use the Web Animations API only for the bounded sequence; keep content visible before JavaScript runs:

```javascript
async function runLetterTransition() {
  const anchor = document.querySelector(".traveling-anchor");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reduce ? 160 : 3000;
  const keyframes = reduce
    ? [{ opacity: 0.4 }, { opacity: 1 }]
    : [
        { transform: "translate3d(-18vw, 12vh, 0) scale(.7)", opacity: 0.35, offset: 0 },
        { transform: "translate3d(12vw, -8vh, 0) scale(1)", opacity: 1, offset: 0.6 },
        { transform: "translate3d(0, 0, 0) scale(.8)", opacity: 1, offset: 1 },
      ];
  await anchor.animate(keyframes, { duration, easing: "cubic-bezier(.16,1,.3,1)", fill: "both" }).finished;
}
```

CSS must express the letter fade and track material around this one sequence. Do not add per-section scroll reveals, bounce easing, or an infinite focal animation.

- [ ] **Step 6: Implement OTP keyboard, paste, retry, rate-limit, and success behavior**

Implement these rules in `experience.js`:

```javascript
function otpValue(boxes) { return boxes.map(box => box.value).join(""); }

function clearOtp(boxes) {
  boxes.forEach(box => { box.value = ""; box.disabled = false; });
  boxes[0].focus();
}

async function submitCode(boxes) {
  if (Date.now() < lockedUntil) return;
  const code = otpValue(boxes);
  if (code.length !== 6) {
    byId("password-feedback").textContent = "请输入完整的六位访问码。";
    return;
  }
  move("SUBMIT", { focus: false });
  boxes.forEach(box => { box.disabled = true; });
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await response.json();
    if (response.ok && data.ok) {
      move("SUCCESS", { focus: false });
      byId("password-feedback").textContent = content.password.success;
      document.documentElement.dataset.auth = "success";
      setTimeout(() => window.location.assign("/map"), 800);
      return;
    }
    if (response.status === 429) {
      move("FAIL", { focus: false });
      const seconds = Number(data.retry || 60);
      lockedUntil = Date.now() + seconds * 1000;
      byId("password-feedback").textContent = `尝试次数过多，请在 ${seconds} 秒后再试。`;
      setTimeout(() => clearOtp(boxes), seconds * 1000);
      return;
    }
    failureCount += 1;
    move("FAIL", { focus: false });
    byId("password-feedback").textContent = core.failureHint(failureCount, content);
    clearOtp(boxes);
  } catch (_) {
    move("FAIL", { focus: false });
    boxes.forEach(box => { box.disabled = false; });
    byId("password-feedback").textContent = "网络暂时不可用，请检查连接后重试。";
  }
}
```

Wire single-digit filtering, automatic forward focus, backward Backspace, six-digit paste, and Enter submission. Bind entry, letter, continue, and back controls once; do not create duplicate listeners when revisiting a view.

- [ ] **Step 7: Run tests and commit when safe**

```bash
node --test tests/experience-core.test.js
python3 -m unittest tests.test_static_contracts -v
test "$(git rev-parse --show-toplevel)" = "$PWD"
git add static/experience.js static/experience.css tests/experience-core.test.js tests/test_static_contracts.py
git commit -m "feat: implement dual-entry letter and password flow"
```

Expected: Node and static contracts PASS. Stop before `git add` if the Git-root check fails.

---

### Task 5: Add Privacy Delivery Rules and Preserve Authentication

**Files:**
- Modify: `app.py:114-148, 192-236`
- Modify: `tests/test_app.py`

**Interfaces:**
- Consumes: Existing `_send`, `_static`, `/`, `/map`, `/api/state`, `/api/login`.
- Produces: `/robots.txt`; `X-Robots-Tag: noindex, nofollow, noarchive` on visitor HTML; correct `.js` and `.css` content types; unchanged signed-cookie boundary.

- [ ] **Step 1: Add failing privacy and content-type tests**

Append to `tests/test_app.py`:

```python
def test_robots_disallows_all_crawlers(self):
    response = self.request("/robots.txt")
    self.assertEqual(response.status, 200)
    self.assertEqual(response.read().decode("utf-8"), "User-agent: *\nDisallow: /\n")

def test_public_html_sends_noindex_header(self):
    response = self.request("/")
    self.assertEqual(response.headers["X-Robots-Tag"], "noindex, nofollow, noarchive")

def test_static_javascript_has_javascript_content_type(self):
    static = Path(os.environ["LOCAPP_BASE"]) / "static"
    (static / "sample.js").write_text("window.ok = true;", encoding="utf-8")
    response = self.request("/static/sample.js")
    self.assertIn("application/javascript", response.headers["Content-Type"])
```

- [ ] **Step 2: Run tests and verify robots/header failures**

```bash
python3 -m unittest discover -s tests -p 'test_app.py' -v
```

Expected: FAIL for `/robots.txt` and the missing `X-Robots-Tag` header.

- [ ] **Step 3: Add the robots route and explicit response headers**

Extend `_send` and `_static` without adding caching or analytics:

```python
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
    with open(fp, "rb") as file:
        self._send(200, file.read(), ctype, headers=extra_headers)
```

Route visitor documents with:

```python
noindex = {"X-Robots-Tag": "noindex, nofollow, noarchive"}
if path == "/":
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
```

Do not change password comparison, signed Cookie generation, 30-day expiry, HttpOnly, SameSite, rate-limit count, or API response data.

- [ ] **Step 4: Run tests and commit when safe**

```bash
python3 -m unittest discover -s tests -p 'test_app.py' -v
test "$(git rev-parse --show-toplevel)" = "$PWD"
git add app.py tests/test_app.py
git commit -m "feat: add private-site delivery headers"
```

Expected: all server tests PASS. Stop before `git add` if the Git-root check fails.

---

### Task 6: Rebuild the Protected Map Surface and Harden Its States

**Files:**
- Modify: `static/map.html:1-239`
- Create: `static/map.css`
- Create: `static/map.js`
- Modify: `tests/test_static_contracts.py`
- Modify: `tests/experience-core.test.js`

**Interfaces:**
- Consumes: `window.L`, `/api/state`, `LocExperience.locationFreshness(timestamp, nowSeconds)`; existing coordinate conversion and polling behavior.
- Produces: DOM states `map-waiting`, `map-stopped`, `map-stale`, `map-error`; `initMap(lat, lon)`, `applyState(data)`, `refresh()`, `retryTiles()`.

- [ ] **Step 1: Add failing map contracts**

Append to `tests/test_static_contracts.py`:

```python
def test_map_has_all_material_states_and_external_assets(self):
    html = self.read("static/map.html")
    for state_id in ("map-waiting", "map-stopped", "map-stale", "map-error"):
        self.assertIn(f'id="{state_id}"', html)
    for asset in ("leaflet.css", "map.css", "leaflet.js", "experience-core.js", "map.js"):
        self.assertIn(asset, html)
    self.assertNotIn("<style>", html)
    self.assertNotRegex(html, re.compile(r"<script>(?!\s*</script>)", re.I))

def test_map_script_preserves_location_contract(self):
    script = self.read("static/map.js")
    for required in ("wgs2gcj", 'fetch("/api/state"', "setInterval(refresh, 10000)", "trailPoints"):
        self.assertIn(required, script)
    self.assertIn("tileerror", script)
    self.assertIn("locationFreshness", script)
```

- [ ] **Step 2: Run static tests and confirm the inline map fails**

```bash
python3 -m unittest tests.test_static_contracts -v
```

Expected: FAIL because the current map lacks stale/tile-error states and keeps CSS/JS inline.

- [ ] **Step 3: Replace `map.html` with a semantic map-first shell**

The body must use this hierarchy:

```html
<main class="map-shell">
  <header class="map-header">
    <div><p class="eyebrow">新的锚点</p><h1>我的位置</h1></div>
    <p class="map-status" id="status-pill"><span aria-hidden="true"></span><span id="status-text">共享中</span></p>
  </header>
  <section class="map-stage" aria-label="共享人的最后位置">
    <div id="map"></div>
    <div class="map-state" id="map-waiting"><p>正在等待共享人的手机上报位置…</p></div>
    <div class="map-state" id="map-stopped" hidden><strong>已停止共享位置</strong><p>共享人重新开启后，这里会自动恢复。</p></div>
    <div class="map-state map-state-quiet" id="map-stale" hidden><p>这是最后已知位置，可能已经过期。</p></div>
    <div class="map-state" id="map-error" hidden><p>地图暂时没有加载出来。</p><button id="retry-map" type="button">重试地图</button></div>
  </section>
  <section class="location-summary" aria-label="位置状态">
    <div><strong id="addr">实时位置</strong><span id="batt-chip">电量 --</span></div>
    <p id="last-update">最后更新：<b>--</b></p>
    <a href="/api/logout">退出查看</a>
  </section>
</main>
```

The document head must include `<meta name="robots" content="noindex,nofollow,noarchive">`. Load `/static/leaflet.css`, `/static/theme.css`, `/static/map.css`, then `/static/leaflet.js`, `/static/experience-core.js`, `/static/map.js` in that order.

- [ ] **Step 4: Move the existing map behavior into `map.js` without semantic changes**

Copy the existing `outOfChina`, `tLat`, `tLon`, `wgs2gcj`, trail cap of 120 points, `fmtElapsed`, `initMap`, `refresh`, one-second elapsed-label timer, initial refresh, and 10-second refresh timer. Change only DOM state application:

```javascript
function applyFreshness(timestamp) {
  const freshness = window.LocExperience.locationFreshness(timestamp, Date.now() / 1000);
  byId("map-stale").hidden = freshness !== "stale";
  document.documentElement.dataset.freshness = freshness;
}

function applyState(data) {
  byId("map-stopped").hidden = !data.stopped;
  byId("status-text").textContent = data.stopped ? "已停止共享" : "共享中";
  if (data.stopped) return;
  if (!data.has_location || data.lat == null || data.lon == null) {
    byId("map-waiting").hidden = false;
    return;
  }
  byId("map-waiting").hidden = true;
  const point = wgs2gcj(data.lat, data.lon);
  if (!map) initMap(point.lat, point.lon);
  marker.setLatLng([point.lat, point.lon]);
  trailPoints.push([point.lat, point.lon]);
  if (trailPoints.length > 120) trailPoints.shift();
  trail.setLatLngs(trailPoints);
  lastTst = data.tst;
  applyFreshness(data.tst);
}

async function refresh() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.status === 401) { window.location.assign("/"); return; }
    const data = await response.json();
    if (data.ok) applyState(data);
  } catch (_) {
    byId("map-error").hidden = false;
  }
}
```

Register Leaflet `tileerror` to show `map-error`; the retry button removes and recreates the tile layer, then hides the error only after a `load` event.

- [ ] **Step 5: Create `map.css` in the approved visual world**

Use a map-dominant layout and the confirmed palette:

```css
body { background: var(--night-3); }
.map-shell { min-height: 100dvh; display: grid; grid-template-rows: auto minmax(360px, 1fr) auto; gap: 14px; padding: max(16px, env(safe-area-inset-top)) 14px max(16px, env(safe-area-inset-bottom)); }
.map-header { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.map-stage { position: relative; min-height: 360px; overflow: hidden; background: var(--map-ground); border-radius: 22px; }
#map { position: absolute; inset: 0; }
.map-state { position: absolute; inset: 0; z-index: 700; display: grid; place-content: center; padding: 24px; text-align: center; color: var(--ink); background: rgba(12,22,34,.78); }
.map-state-quiet { inset: auto 12px 12px; display: block; border-radius: 10px; padding: 10px 12px; }
.location-summary { display: grid; gap: 8px; color: var(--ink); }
.pin-core { background: var(--anchor); border: 2px solid var(--ink); }
@media (min-width: 800px) { .map-shell { grid-template-columns: minmax(0, 1fr) 280px; grid-template-rows: auto 1fr; } .map-header { grid-column: 1 / -1; } .location-summary { align-content: end; } }
```

Keep the map attribution legible. The warm marker may pulse softly while active, but it must stop when sharing is stopped, the page is hidden, or reduced motion is enabled.

- [ ] **Step 6: Run tests and commit when safe**

```bash
node --test tests/experience-core.test.js
python3 -m unittest tests.test_static_contracts -v
test "$(git rev-parse --show-toplevel)" = "$PWD"
git add static/map.html static/map.css static/map.js tests/test_static_contracts.py tests/experience-core.test.js
git commit -m "feat: rebuild protected map experience"
```

Expected: state, content, and static tests PASS. Stop before `git add` if the Git-root check fails.

---

### Task 7: Run End-to-End Hardening, Accessibility, and Visual Verification

**Files:**
- Modify as findings require: `static/index.html`, `static/theme.css`, `static/experience.css`, `static/experience.js`, `static/map.html`, `static/map.css`, `static/map.js`, `app.py`
- Modify: `tests/test_static_contracts.py`
- Create: `.impeccable/review/hero-repro.png`
- Create: `.impeccable/review/desktop.png`
- Create: `.impeccable/review/mobile.png`

**Interfaces:**
- Consumes: Completed visitor flow, server tests, Node tests, design spec, and approved full-flow mockup.
- Produces: Verified desktop/mobile/reduced-motion behavior, screenshots, mechanical detector report, and final regression result.

- [ ] **Step 1: Add final accessibility and regression contracts**

Append to `tests/test_static_contracts.py`:

```python
def test_inputs_and_dynamic_status_are_accessible(self):
    entry = self.read("static/index.html")
    map_html = self.read("static/map.html")
    self.assertIn('aria-live="polite"', entry)
    self.assertIn('role="group" aria-label="六位访问码"', entry)
    self.assertIn('aria-label="共享人的最后位置"', map_html)
    self.assertIn('<button id="retry-map"', map_html)

def test_reduced_motion_and_small_screen_rules_exist(self):
    experience = self.read("static/experience.css")
    theme = self.read("static/theme.css")
    self.assertIn("prefers-reduced-motion", experience)
    self.assertIn("max-width: 359px", experience)
    self.assertIn("min-width: 320px", theme)

def test_public_files_contain_no_secret_defaults(self):
    public = "\n".join(
        self.read(path)
        for path in (
            "static/index.html", "static/content.js", "static/experience-core.js",
            "static/experience.js", "static/map.html", "static/map.js",
        )
    )
    self.assertNotIn("owner123", public)
    self.assertNotIn('FRIEND_CODE', public)
    self.assertNotRegex(public, re.compile(r"navigator\.geolocation|sendBeacon|google-analytics", re.I))
```

- [ ] **Step 2: Run the complete automated suite**

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/experience-core.test.js
python3 -m py_compile app.py
```

Expected: all Python and Node tests PASS; `app.py` compiles without output.

- [ ] **Step 3: Start a deterministic local test server**

Use a task-owned runtime directory and the committed fixture:

```bash
mkdir -p work/qa-runtime/static work/qa-runtime/store/last/test-user/test-device
cp static/* work/qa-runtime/static/
cp tests/fixtures/store/last/test-user/test-device/location.json work/qa-runtime/store/last/test-user/test-device/location.json
LOCAPP_BASE="$PWD/work/qa-runtime" LOCAPP_STORE="$PWD/work/qa-runtime/store" LOCAPP_FLAG="$PWD/work/qa-runtime/stopped" LOCAPP_SECRET_FILE="$PWD/work/qa-runtime/secret" FRIEND_CODE="654321" OWNER_PASS="owner-test" python3 app.py
```

Expected: server listens on `http://127.0.0.1:8000` and the fixture appears after login with `654321`.

- [ ] **Step 4: Verify every critical path in the browser**

Use the in-app browser and check these paths once as one bounded inspection round:

1. Clear `letter_seen`; confirm letter is primary and location remains visible.
2. Open the letter; confirm opening and closing copy, no empty-body gap, back button, and continue button.
3. Continue; confirm approximately 3-second anchor transition and empty transition copy.
4. Enter three wrong codes; confirm the exact three messages and no aggressive red alert.
5. Enter `654321`; confirm success copy and the approximately 800ms anchor-to-map transition.
6. Reload root; confirm location is now primary and letter remains available.
7. Confirm a valid Cookie allows direct map entry.
8. Force stopped, missing, stale, network-error, and tile-error states; each must retain a clear status and recovery path.
9. Navigate entirely by keyboard; paste six digits; verify visible focus and no focus trap.
10. Repeat with reduced motion; confirm no long travel or parallax and no lost feedback.

- [ ] **Step 5: Capture desktop and mobile evidence in one pass**

Capture the approved first viewport comparison and final pages:

```text
.impeccable/review/hero-repro.png  — entry viewport at the approved mockup dimensions
.impeccable/review/desktop.png     — complete visitor flow representative at desktop width
.impeccable/review/mobile.png      — complete visitor flow representative at 390px width
```

Open each captured image once and confirm it is not blank, clipped, mid-animation, or showing the wrong state. Also inspect 320px width and 200% text zoom even when they are not separate deliverable captures.

- [ ] **Step 6: Run the Impeccable mechanical detector once and batch fixes**

```bash
node /Users/hl/.codex/skills/impeccable/scripts/detect.mjs --json static/index.html static/theme.css static/experience.css static/experience.js static/map.html static/map.css static/map.js
```

Fix all mechanical findings that do not conflict with the confirmed design in one batch. Re-run the automated suite, then perform at most one confirmation screenshot round.

- [ ] **Step 7: Run final regression and commit when safe**

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/experience-core.test.js
python3 -m py_compile app.py
test "$(git rev-parse --show-toplevel)" = "$PWD"
git add app.py static tests .impeccable/review
git commit -m "feat: complete starfield location experience"
```

Expected: all automated checks PASS, the browser paths match the spec, and the Git-root check succeeds before staging. If the project still has no independent repository, stop after verification and report the uncommitted file list.
