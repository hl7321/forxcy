const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MAP_SCRIPT = fs.readFileSync(path.join(__dirname, "../static/map.js"), "utf8");
const STATE_IDS = ["map-error", "map-stopped", "map-waiting", "map-stale"];

class FakeClassList {
  constructor() {
    this.names = new Set();
  }

  toggle(name, force) {
    if (force) this.names.add(name);
    else this.names.delete(name);
  }

  contains(name) {
    return this.names.has(name);
  }
}

class FakeElement {
  constructor({ hidden = false } = {}) {
    this.hidden = hidden;
    this.textContent = "";
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.bold = null;
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }

  querySelector(selector) {
    return selector === "b" ? this.bold : null;
  }

  click() {
    return this.listeners.get("click")?.();
  }
}

function response(data, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return data;
    },
  };
}

function state(overrides = {}) {
  return {
    ok: true,
    stopped: false,
    has_location: false,
    ...overrides,
  };
}

async function createHarness({ fetches = [response(state())], nowSeconds = 1000 } = {}) {
  const elements = new Map();
  for (const id of STATE_IDS) elements.set(id, new FakeElement({ hidden: id !== "map-waiting" }));
  for (const id of ["status-text", "status-pill", "batt-chip", "retry-map"]) {
    elements.set(id, new FakeElement());
  }
  const lastUpdate = new FakeElement();
  lastUpdate.bold = new FakeElement();
  elements.set("last-update", lastUpdate);

  const documentListeners = new Map();
  const documentElement = { dataset: {} };
  const document = {
    hidden: false,
    documentElement,
    getElementById(id) {
      return elements.get(id);
    },
    addEventListener(name, handler) {
      documentListeners.set(name, handler);
    },
  };

  const intervals = [];
  const timers = [];
  const redirects = [];
  const fetchQueue = [...fetches];
  let fetchCalls = 0;
  const leaflet = {
    maps: [],
    markers: [],
    trails: [],
    layers: [],
    removedLayers: [],
    divIcon(options) {
      return options;
    },
    map() {
      const instance = {
        setView() {
          return instance;
        },
        invalidateSize() {},
        removeLayer(layer) {
          leaflet.removedLayers.push(layer);
        },
      };
      leaflet.maps.push(instance);
      return instance;
    },
    marker() {
      const instance = {
        icons: [],
        points: [],
        addTo() {
          return instance;
        },
        setIcon(icon) {
          instance.icons.push(icon);
          return instance;
        },
        setLatLng(point) {
          instance.points.push(point);
          return instance;
        },
      };
      leaflet.markers.push(instance);
      return instance;
    },
    polyline() {
      const instance = {
        points: [],
        addTo() {
          return instance;
        },
        setLatLngs(points) {
          instance.points = [...points];
          return instance;
        },
      };
      leaflet.trails.push(instance);
      return instance;
    },
    tileLayer() {
      const handlers = new Map();
      const instance = {
        on(name, handler) {
          handlers.set(name, handler);
          return instance;
        },
        addTo() {
          return instance;
        },
        emit(name) {
          handlers.get(name)?.();
        },
      };
      leaflet.layers.push(instance);
      return instance;
    },
  };

  let freshnessCalls = 0;
  const locationFreshness = (timestamp, now) => {
    freshnessCalls += 1;
    if (timestamp == null) return "missing";
    return now - timestamp > 300 ? "stale" : "fresh";
  };
  const window = {
    L: leaflet,
    LocExperience: { locationFreshness },
    location: {
      assign(url) {
        redirects.push(url);
      },
    },
    setInterval(handler, milliseconds) {
      intervals.push({ handler, milliseconds });
    },
    setTimeout(handler, milliseconds) {
      const timer = { handler, milliseconds, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  };
  class FakeDate extends Date {
    static now() {
      return nowSeconds * 1000;
    }
  }
  const fetch = async () => {
    fetchCalls += 1;
    assert.ok(fetchQueue.length, "test must provide every expected fetch response");
    const next = fetchQueue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const context = {
    Date: FakeDate,
    document,
    fetch,
    setInterval: window.setInterval,
    window,
  };

  vm.runInNewContext(MAP_SCRIPT, context, { filename: "static/map.js" });
  await new Promise((resolve) => setImmediate(resolve));

  return {
    api: window.LocMap,
    elements,
    enqueueFetch(next) {
      fetchQueue.push(next);
    },
    freshnessCalls() {
      return freshnessCalls;
    },
    intervals,
    fetchCalls() {
      return fetchCalls;
    },
    leaflet,
    redirects,
    async runTimers(milliseconds) {
      for (const timer of timers.filter((item) => !item.cleared && item.milliseconds === milliseconds)) {
        timer.cleared = true;
        timer.handler();
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
    visibleStates() {
      return STATE_IDS.filter((id) => !elements.get(id).hidden);
    },
  };
}

function activeLocation(overrides = {}) {
  return state({
    has_location: true,
    lat: 31.2304,
    lon: 121.4737,
    tst: 900,
    batt: 82,
    ...overrides,
  });
}

test("an offline API recovers without leaving the error state behind", async () => {
  const harness = await createHarness({ fetches: [new Error("offline")] });
  assert.ok(harness.api, "map.js must expose its behavior API as window.LocMap");
  assert.deepEqual(harness.visibleStates(), ["map-error"]);

  harness.enqueueFetch(response(activeLocation()));
  await harness.api.refresh();

  assert.deepEqual(harness.visibleStates(), []);
  assert.equal(harness.leaflet.maps.length, 1);
  assert.equal(harness.leaflet.markers.length, 1);
});

test("a failed tile cycle stays errored until a clean retry layer loads", async () => {
  const harness = await createHarness({ fetches: [response(activeLocation())] });
  assert.ok(harness.api, "map.js must expose its behavior API as window.LocMap");
  const failedLayer = harness.leaflet.layers[0];

  failedLayer.emit("tileerror");
  failedLayer.emit("load");
  assert.deepEqual(harness.visibleStates(), ["map-error"]);

  harness.elements.get("retry-map").click();
  assert.equal(harness.leaflet.layers.length, 2);
  assert.deepEqual(harness.leaflet.removedLayers, [failedLayer]);
  assert.deepEqual(harness.visibleStates(), ["map-error"]);

  harness.leaflet.layers[1].emit("load");
  assert.deepEqual(harness.visibleStates(), []);
});

test("API recovery clears only the API error while a tile error remains", async () => {
  const harness = await createHarness({ fetches: [response(activeLocation())] });
  assert.ok(harness.api, "map.js must expose its behavior API as window.LocMap");
  harness.leaflet.layers[0].emit("tileerror");

  harness.enqueueFetch(new Error("offline"));
  await harness.api.refresh();
  harness.enqueueFetch(response(activeLocation({ tst: 950 })));
  await harness.api.refresh();

  assert.deepEqual(harness.visibleStates(), ["map-error"]);
  harness.elements.get("retry-map").click();
  harness.leaflet.layers[1].emit("load");
  assert.deepEqual(harness.visibleStates(), []);
});

test("material states follow error, stopped, waiting, stale, active priority", async () => {
  const harness = await createHarness();
  assert.ok(harness.api, "map.js must expose its behavior API as window.LocMap");

  harness.api.applyState(activeLocation({ tst: 699 }));
  assert.deepEqual(harness.visibleStates(), ["map-stale"]);

  harness.api.applyState(state({ stopped: true }));
  assert.deepEqual(harness.visibleStates(), ["map-stopped"]);

  harness.enqueueFetch(new Error("offline"));
  await harness.api.refresh();
  assert.deepEqual(harness.visibleStates(), ["map-error"]);
});

test("stopped sharing can resume active without duplicating the map or marker", async () => {
  const harness = await createHarness();
  assert.ok(harness.api, "map.js must expose its behavior API as window.LocMap");

  harness.api.applyState(activeLocation({ tst: 940 }));
  harness.api.applyState(state({ stopped: true }));
  harness.api.applyState(activeLocation({ tst: 950 }));
  harness.api.applyState(activeLocation({ lat: 31.24, lon: 121.48, tst: 960 }));

  assert.deepEqual(harness.visibleStates(), []);
  assert.equal(harness.leaflet.maps.length, 1);
  assert.equal(harness.leaflet.markers.length, 1);
  assert.equal(harness.leaflet.markers[0].points.length, 3);
});

test("freshness timer runs only while sharing is active with a location", async () => {
  const harness = await createHarness();
  assert.ok(harness.api, "map.js must expose its behavior API as window.LocMap");
  const elapsedTimer = harness.intervals.find(({ milliseconds }) => milliseconds === 1000);

  elapsedTimer.handler();
  assert.equal(harness.freshnessCalls(), 0);
  harness.api.applyState(activeLocation({ tst: 699 }));
  assert.equal(harness.freshnessCalls(), 1);
  harness.api.applyState(state({ stopped: true }));
  elapsedTimer.handler();
  assert.equal(harness.freshnessCalls(), 1);
  assert.deepEqual(harness.visibleStates(), ["map-stopped"]);

  harness.api.applyState(activeLocation({ tst: 950 }));
  assert.equal(harness.freshnessCalls(), 2);
  elapsedTimer.handler();
  assert.equal(harness.freshnessCalls(), 3);
});

test("a 401 redirects to the public entry without creating a map", async () => {
  const harness = await createHarness({ fetches: [response({ ok: false }, 401)] });
  assert.ok(harness.api, "map.js must expose its behavior API as window.LocMap");

  assert.deepEqual(harness.redirects, ["/"]);
  assert.equal(harness.leaflet.maps.length, 0);
  assert.equal(harness.leaflet.markers.length, 0);
});

test("a stalled state request times out and a later refresh can recover", async () => {
  const stalled = new Promise(() => {});
  const harness = await createHarness({ fetches: [stalled] });
  assert.equal(harness.fetchCalls(), 1);

  await harness.runTimers(8000);
  assert.deepEqual(harness.visibleStates(), ["map-error"]);

  harness.enqueueFetch(response(activeLocation({ tst: 950 })));
  await harness.api.refresh();
  assert.equal(harness.fetchCalls(), 2);
  assert.deepEqual(harness.visibleStates(), []);
});

test("a stalled state response body is covered by the refresh timeout", async () => {
  const stalledBody = { status: 200, ok: true, json() { return new Promise(() => {}); } };
  const harness = await createHarness({ fetches: [stalledBody] });

  await harness.runTimers(8000);

  assert.deepEqual(harness.visibleStates(), ["map-error"]);
});

test("the polling interval does not overlap an in-flight state request", async () => {
  const stalled = new Promise(() => {});
  const harness = await createHarness({ fetches: [stalled] });
  const pollTimer = harness.intervals.find(({ milliseconds }) => milliseconds === 10000);

  const first = harness.api.refresh();
  const second = pollTimer.handler();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.fetchCalls(), 1);
  assert.equal(first, second);
});
