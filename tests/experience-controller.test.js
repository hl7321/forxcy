const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const content = require("../static/content.js");
const core = require("../static/experience-core.js");
const controller = fs.readFileSync(path.join(__dirname, "../static/experience.js"), "utf8");

class FakeClassList {
  toggle() {}
  remove() {}
}

class FakeAnimation {
  constructor(element, keyframes, timing, mode = "pending") {
    this.element = element;
    this.keyframes = keyframes;
    this.timing = timing;
    if (mode === "reject") {
      this.finished = Promise.reject(new Error("animation cancelled"));
      this.finished.catch(() => undefined);
      this.finish = () => {};
    } else if (mode === "unfinished") {
      this.finished = undefined;
      this.finish = () => {};
    } else {
      this.finished = new Promise((resolve) => { this.finish = resolve; });
    }
    this.pause = () => { this.paused = true; };
    this.play = () => { this.paused = false; this.played = true; };
    this.cancel = () => { this.cancelled = true; this.finish(); };
  }
}

class FakeElement {
  constructor(id = "", rect = { left: 0, width: 40, height: 20 }) {
    this.id = id;
    this.rect = rect;
    this.children = [];
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.queryTarget = null;
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }

  dispatch(name, event = {}) {
    return this.listeners.get(name)?.(event);
  }

  replaceChildren(...children) {
    this.children = children;
    children.forEach((child, index) => {
      child.rect = { left: 30 + index * 50, width: 40, height: 56 };
    });
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  querySelector() {
    return this.queryTarget;
  }

  focus() {}

  getBoundingClientRect() {
    return this.rect;
  }
}

async function createHarness(reduce, {
  animationMode = "pending",
  autoLogin = true,
  fetches,
  intersectionObserver = false,
} = {}) {
  const animations = [];
  const redirects = [];
  const storage = new Map();
  const timers = [];
  const windowListeners = new Map();
  const observers = [];
  const ids = [
    "entry-title", "letter-opening", "letter-body", "letter-closing", "transition-copy",
    "password-hint", "otp", "open-letter", "open-location", "letter-back",
    "letter-continue", "password-back", "experience-shell", "view-entry", "view-letter",
    "view-transition", "view-password", "password-feedback", "password-title",
    "letter-copy", "letter-pause", "letter-full",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  elements.get("otp").rect = { left: 20, width: 300, height: 56 };
  elements.get("view-entry").queryTarget = elements.get("open-letter");
  elements.get("view-letter").queryTarget = elements.get("letter-back");
  elements.get("view-password").queryTarget = elements.get("password-back");

  const dataCopy = new Map([
    ["letter-title", new FakeElement()],
    ["letter-description", new FakeElement()],
    ["location-title", new FakeElement()],
    ["location-description", new FakeElement()],
  ]);
  const travelingAnchor = new FakeElement("traveling-anchor");
  elements.get("letter-continue").rect = { top: 900, bottom: 944, left: 0, width: 120, height: 44 };
  const documentElement = { dataset: {} };
  const document = {
    documentElement,
    createElement() {
      const element = new FakeElement();
      if (animationMode !== "missing") {
        element.animate = (keyframes, timing) => {
          if (animationMode === "throw") throw new Error("animate unavailable");
          const animation = new FakeAnimation(element, keyframes, timing, animationMode);
          animations.push(animation);
          return animation;
        };
      }
      return element;
    },
    getElementById(id) {
      return elements.get(id);
    },
    querySelector(selector) {
      const copy = selector.match(/^\[data-copy="([^"]+)"\]$/);
      if (copy) return dataCopy.get(copy[1]);
      if (selector === ".traveling-anchor") return travelingAnchor;
      return null;
    },
    addEventListener() {},
  };
  for (const element of [...elements.values(), travelingAnchor]) {
    if (animationMode === "missing") continue;
    element.animate = (keyframes, timing) => {
      if (animationMode === "throw") throw new Error("animate unavailable");
      const animation = new FakeAnimation(element, keyframes, timing, animationMode);
      animations.push(animation);
      return animation;
    };
  }

  const responses = fetches ? [...fetches] : [
    { ok: false, async json() { return { ok: false }; } },
    { ok: true, async json() { return { ok: true }; } },
  ];
  let fetchCalls = 0;
  const window = {
    LOCAPP_CONTENT: content,
    LocExperience: core,
    location: { assign(url) { redirects.push(url); } },
    innerHeight: 600,
    addEventListener(name, handler) { windowListeners.set(name, handler); },
  };
  function setTimeoutFake(handler, milliseconds) {
    const timer = { handler, milliseconds, cleared: false };
    timers.push(timer);
    return timer;
  }
  function clearTimeoutFake(timer) {
    if (timer) timer.cleared = true;
  }
  const context = {
    document,
    fetch: async () => {
      fetchCalls += 1;
      const next = responses.shift();
      return typeof next === "function" ? next() : next;
    },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
    },
    matchMedia: () => ({ matches: reduce }),
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
    window,
  };
  if (intersectionObserver) {
    context.IntersectionObserver = class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe(target) { this.target = target; }
    };
  }
  vm.runInNewContext(controller, context, { filename: "static/experience.js" });

  const boxes = elements.get("otp").children;
  if (autoLogin) {
    await elements.get("open-location").dispatch("click");
    boxes.forEach((box) => { box.value = "1"; });
    boxes.at(-1).dispatch("keydown", { key: "Enter", preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
  }

  return {
    animations,
    boxes,
    documentElement,
    elements,
    fetchCalls() { return fetchCalls; },
    observers,
    redirects,
    storage,
    timers,
    window,
    windowListeners,
    async flush() {
      await new Promise((resolve) => setImmediate(resolve));
    },
    async runTimers(milliseconds) {
      for (const timer of timers.filter((item) => !item.cleared && item.milliseconds === milliseconds)) {
        timer.cleared = true;
        timer.handler();
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
    async finishAnimations() {
      animations.forEach((animation) => animation.finish());
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("password success waits for the 800ms gather animation before navigating", async () => {
  const harness = await createHarness(false);

  assert.equal(harness.documentElement.dataset.auth, "success");
  assert.equal(harness.elements.get("password-feedback").textContent, content.password.success);
  assert.deepEqual(harness.redirects, []);
  assert.equal(harness.animations.length, 10);
  assert.ok(harness.animations.every(({ timing }) => timing.duration === 800));
  assert.ok(harness.animations.slice(0, 6).every(({ keyframes }) => keyframes[1].transform.includes("translate3d")));
  assert.ok(harness.animations.at(-1).keyframes.every(({ opacity }) => opacity === 1));

  await harness.finishAnimations();
  assert.deepEqual(harness.redirects, ["/map"]);
});

test("reduced password success uses short opacity-only motion and still awaits completion", async () => {
  const harness = await createHarness(true);

  assert.equal(harness.elements.get("password-feedback").textContent, content.password.success);
  assert.deepEqual(harness.redirects, []);
  assert.equal(harness.animations.length, 10);
  assert.ok(harness.animations.every(({ timing }) => timing.duration === 180));
  assert.ok(harness.animations.every(({ keyframes }) => keyframes.every((frame) => !("transform" in frame))));

  await harness.finishAnimations();
  assert.deepEqual(harness.redirects, ["/map"]);
});

for (const animationMode of ["missing", "throw", "reject"]) {
  test(`letter and password routes recover when animation mode is ${animationMode}`, async () => {
    const sessionResponse = { ok: false, status: 401, async json() { return { ok: false }; } };
    const loginResponse = { ok: true, status: 200, async json() { return { ok: true }; } };
    const harness = await createHarness(false, {
      animationMode,
      autoLogin: false,
      fetches: [sessionResponse, loginResponse],
    });

    harness.elements.get("open-letter").dispatch("click");
    const transition = harness.elements.get("letter-continue").dispatch("click");
    await harness.flush();
    assert.equal(harness.elements.get("experience-shell").dataset.state, "transition");
    await harness.runTimers(3000);
    await transition;
    assert.equal(harness.elements.get("experience-shell").dataset.state, "password-idle");

    harness.boxes.forEach((box) => { box.value = "1"; });
    harness.boxes.at(-1).dispatch("keydown", { key: "Enter", preventDefault() {} });
    await harness.flush();
    assert.equal(harness.elements.get("experience-shell").dataset.state, "password-success");
    assert.deepEqual(harness.redirects, []);
    await harness.runTimers(800);
    assert.deepEqual(harness.redirects, ["/map"]);
  });
}

test("a stalled session check times out and allows location entry to be retried", async () => {
  const stalled = new Promise(() => {});
  const unauthenticated = { ok: false, status: 401, async json() { return { ok: false }; } };
  const harness = await createHarness(false, { autoLogin: false, fetches: [stalled, unauthenticated] });

  harness.elements.get("open-location").dispatch("click");
  await harness.flush();
  await harness.runTimers(8000);
  assert.equal(harness.elements.get("experience-shell").dataset.state, "password-idle");
  assert.equal(
    harness.elements.get("password-feedback").textContent,
    "网络暂时不可用，请检查连接后重试。",
  );
  harness.elements.get("password-back").dispatch("click");
  await harness.elements.get("open-location").dispatch("click");
  assert.equal(harness.fetchCalls(), 2);
  assert.equal(harness.elements.get("experience-shell").dataset.state, "password-idle");
});

test("a stalled login times out with the entered code still interactive", async () => {
  const unauthenticated = { ok: false, status: 401, async json() { return { ok: false }; } };
  const stalled = new Promise(() => {});
  const harness = await createHarness(false, { autoLogin: false, fetches: [unauthenticated, stalled] });

  await harness.elements.get("open-location").dispatch("click");
  harness.boxes.forEach((box) => { box.value = "1"; });
  harness.boxes.at(-1).dispatch("keydown", { key: "Enter", preventDefault() {} });
  await harness.flush();
  await harness.runTimers(8000);
  assert.equal(harness.elements.get("experience-shell").dataset.state, "password-error");
  assert.equal(
    harness.elements.get("password-feedback").textContent,
    "网络暂时不可用，请检查连接后重试。",
  );
  assert.ok(harness.boxes.every((box) => box.value === "1" && box.disabled === false));
});

test("a stalled login response body is covered by the same timeout", async () => {
  const unauthenticated = { ok: false, status: 401, async json() { return { ok: false }; } };
  const stalledBody = { ok: true, status: 200, json() { return new Promise(() => {}); } };
  const harness = await createHarness(false, {
    autoLogin: false,
    fetches: [unauthenticated, stalledBody],
  });

  await harness.elements.get("open-location").dispatch("click");
  harness.boxes.forEach((box) => { box.value = "1"; });
  harness.boxes.at(-1).dispatch("keydown", { key: "Enter", preventDefault() {} });
  await harness.flush();
  await harness.runTimers(8000);

  assert.equal(harness.elements.get("experience-shell").dataset.state, "password-error");
  assert.ok(harness.boxes.every((box) => box.value === "1" && box.disabled === false));
});

test("reaching the letter end records letter_seen before returning home", async () => {
  const harness = await createHarness(false, { autoLogin: false, intersectionObserver: true });
  harness.elements.get("open-letter").dispatch("click");
  assert.equal(harness.storage.get("letter_seen"), undefined);

  harness.observers[0].callback([{ target: harness.elements.get("letter-continue"), isIntersecting: true }]);
  harness.elements.get("letter-back").dispatch("click");

  assert.equal(harness.storage.get("letter_seen"), "true");
  assert.equal(harness.elements.get("open-location").dataset.priority, "primary");
});

test("scroll geometry records letter_seen when IntersectionObserver is unavailable", async () => {
  const harness = await createHarness(false, { autoLogin: false });
  harness.elements.get("open-letter").dispatch("click");
  assert.equal(harness.storage.get("letter_seen"), undefined);

  harness.elements.get("letter-continue").rect = { top: 520, bottom: 564, left: 0, width: 120, height: 44 };
  harness.windowListeners.get("scroll")();

  assert.equal(harness.storage.get("letter_seen"), "true");
});

test("typing the sixth digit submits the access code without an Enter key", async () => {
  const unauthenticated = { ok: false, status: 401, async json() { return { ok: false }; } };
  const rejected = { ok: false, status: 403, async json() { return { ok: false }; } };
  const harness = await createHarness(false, {
    autoLogin: false,
    fetches: [unauthenticated, rejected],
  });

  await harness.elements.get("open-location").dispatch("click");
  harness.boxes.forEach((box) => {
    box.value = "1";
    box.dispatch("input");
  });
  await harness.flush();

  assert.equal(harness.fetchCalls(), 2);
  assert.equal(harness.elements.get("experience-shell").dataset.state, "password-error");
  assert.equal(harness.elements.get("password-feedback").textContent, content.password.failureHints[0]);
});

test("pasting six digits submits the access code without an Enter key", async () => {
  const unauthenticated = { ok: false, status: 401, async json() { return { ok: false }; } };
  const rejected = { ok: false, status: 403, async json() { return { ok: false }; } };
  const harness = await createHarness(false, {
    autoLogin: false,
    fetches: [unauthenticated, rejected],
  });

  await harness.elements.get("open-location").dispatch("click");
  harness.elements.get("otp").dispatch("paste", {
    clipboardData: { getData() { return "111111"; } },
    preventDefault() {},
  });
  await harness.flush();

  assert.equal(harness.fetchCalls(), 2);
  assert.equal(harness.elements.get("experience-shell").dataset.state, "password-error");
  assert.equal(harness.elements.get("password-feedback").textContent, content.password.failureHints[0]);
});

test("letter body plays one caption at a time and pause controls the active caption", async () => {
  const harness = await createHarness(false, { autoLogin: false });

  harness.elements.get("open-letter").dispatch("click");
  await harness.flush();

  assert.equal(harness.elements.get("view-letter").dataset.letterMode, "playing");
  assert.equal(harness.animations.length, 1);
  assert.equal(harness.animations[0].element.textContent, content.letter.body[0]);

  harness.elements.get("letter-pause").dispatch("click");
  assert.equal(harness.animations[0].paused, true);
  assert.equal(harness.elements.get("letter-pause").textContent, "继续");

  harness.elements.get("letter-pause").dispatch("click");
  assert.equal(harness.animations[0].played, true);
  assert.equal(harness.elements.get("letter-pause").textContent, "暂停");

  harness.animations[0].finish();
  await harness.flush();
  assert.equal(harness.animations.length, 2);
  assert.equal(harness.animations[1].element.textContent, content.letter.body[1]);
});

test("touching the active caption advances directly to the next caption", async () => {
  const harness = await createHarness(false, { autoLogin: false });

  harness.elements.get("open-letter").dispatch("click");
  await harness.flush();
  harness.elements.get("letter-body").dispatch("click");
  await harness.flush();

  assert.equal(harness.animations.length, 2);
  assert.equal(harness.animations[1].element.textContent, content.letter.body[1]);
});

test("touching advances captions when animation.finished is unavailable", async () => {
  const harness = await createHarness(false, {
    animationMode: "unfinished",
    autoLogin: false,
  });

  harness.elements.get("open-letter").dispatch("click");
  await harness.flush();
  harness.elements.get("letter-body").dispatch("click");
  await harness.flush();

  assert.equal(harness.animations.length, 2);
  assert.equal(harness.animations[1].element.textContent, content.letter.body[1]);
});

test("touching the final active caption completes subtitle playback", async () => {
  const harness = await createHarness(false, { autoLogin: false });

  harness.elements.get("open-letter").dispatch("click");
  await harness.flush();
  for (const _ of content.letter.body) {
    harness.elements.get("letter-body").dispatch("click");
    await harness.flush();
  }

  assert.equal(harness.elements.get("view-letter").dataset.letterMode, "complete");
});

test("touching a paused caption does not advance playback", async () => {
  const harness = await createHarness(false, { autoLogin: false });

  harness.elements.get("open-letter").dispatch("click");
  await harness.flush();
  harness.elements.get("letter-pause").dispatch("click");
  harness.elements.get("letter-body").dispatch("click");
  await harness.flush();

  assert.equal(harness.animations.length, 1);
  assert.equal(harness.elements.get("view-letter").dataset.letterMode, "paused");
});

test("full-letter control interrupts captions and reveals the complete copy", async () => {
  const harness = await createHarness(false, { autoLogin: false });

  harness.elements.get("open-letter").dispatch("click");
  await harness.flush();
  harness.elements.get("letter-full").dispatch("click");

  assert.equal(harness.animations[0].cancelled, true);
  assert.equal(harness.elements.get("view-letter").dataset.letterMode, "full");
  assert.equal(harness.elements.get("letter-full").textContent, "重新播放字幕");
});

test("full-letter control releases completed captions as well as the active caption", async () => {
  const harness = await createHarness(false, { autoLogin: false });

  harness.elements.get("open-letter").dispatch("click");
  await harness.flush();
  harness.animations[0].finish();
  await harness.flush();
  harness.elements.get("letter-full").dispatch("click");

  assert.equal(harness.animations.length, 2);
  assert.equal(harness.animations[0].cancelled, true);
  assert.equal(harness.animations[1].cancelled, true);
  assert.equal(harness.elements.get("view-letter").dataset.letterMode, "full");
});

test("reduced motion shows the complete letter without autoplay captions", async () => {
  const harness = await createHarness(true, { autoLogin: false });

  harness.elements.get("open-letter").dispatch("click");
  await harness.flush();

  assert.equal(harness.elements.get("view-letter").dataset.letterMode, "full");
  assert.equal(harness.animations.length, 0);
});

test("caption sequence waits for its duration when animation.finished is unavailable", async () => {
  const harness = await createHarness(false, { animationMode: "unfinished", autoLogin: false });

  harness.elements.get("open-letter").dispatch("click");
  await harness.flush();
  assert.equal(harness.animations.length, 1);

  await harness.runTimers(harness.animations[0].timing.duration);
  assert.equal(harness.animations.length, 2);
  assert.equal(harness.animations[1].element.textContent, content.letter.body[1]);
});
