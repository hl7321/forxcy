(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const TILE_URL = "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}";
  const TILE_OPTIONS = {
    subdomains: ["1", "2", "3", "4"],
    maxZoom: 18,
    attribution: "高德地图",
  };
  const REQUEST_TIMEOUT_MS = 8000;

  let map;
  let marker;
  let trail;
  let tileLayer;
  const trailPoints = [];
  let lastTst = null;
  let refreshInFlight = null;
  let refreshSequence = 0;
  let latestAppliedSequence = 0;
  const materialState = {
    apiError: false,
    tileError: false,
    stopped: false,
    hasLocation: false,
    freshness: "missing",
  };

  async function fetchWithTimeout(url, options = {}, consume = response => response) {
    const controller = typeof window.AbortController === "function" ? new window.AbortController() : null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => {
        if (controller) controller.abort();
        reject(new Error("request timed out"));
      }, REQUEST_TIMEOUT_MS);
    });
    try {
      const requestOptions = controller ? { ...options, signal: controller.signal } : options;
      const request = fetch(url, requestOptions).then(consume);
      return await Promise.race([request, timeout]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  // WGS-84 → GCJ-02（高德地图坐标）
  const PI = Math.PI;
  const A = 6378245.0;
  const EE = 0.00669342162296594323;

  function outOfChina(lat, lon) {
    return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }

  function tLat(x, y) {
    let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    result += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
    result += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
    result += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
    return result;
  }

  function tLon(x, y) {
    let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    result += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
    result += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
    result += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
    return result;
  }

  function wgs2gcj(lat, lon) {
    if (outOfChina(lat, lon)) return { lat, lon };
    let dLat = tLat(lon - 105, lat - 35);
    let dLon = tLon(lon - 105, lat - 35);
    const radLat = lat / 180 * PI;
    let magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
    dLon = (dLon * 180) / (A / sqrtMagic * Math.cos(radLat) * PI);
    return { lat: lat + dLat, lon: lon + dLon };
  }

  function pinIcon(stopped) {
    return window.L.divIcon({
      className: "",
      html: `<div class="pin-wrap${stopped ? " stopped" : ""}"><div class="pin-core"></div></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
  }

  function fmtElapsed(timestamp) {
    const seconds = Math.max(0, Math.round(Date.now() / 1000 - timestamp));
    if (seconds < 5) return "刚刚";
    if (seconds < 60) return `${seconds} 秒前`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} 分钟前`;
    return `${Math.floor(minutes / 60)} 小时前`;
  }

  function renderMaterialState() {
    let visibleState = null;
    if (materialState.apiError || materialState.tileError) visibleState = "map-error";
    else if (materialState.stopped) visibleState = "map-stopped";
    else if (!materialState.hasLocation) visibleState = "map-waiting";
    else if (materialState.freshness === "stale") visibleState = "map-stale";

    for (const stateId of ["map-error", "map-stopped", "map-waiting", "map-stale"]) {
      byId(stateId).hidden = stateId !== visibleState;
    }
    document.documentElement.dataset.mapState = visibleState ? visibleState.slice(4) : "active";
  }

  function createTileLayer() {
    const layer = window.L.tileLayer(TILE_URL, TILE_OPTIONS);
    let failedTiles = 0;
    tileLayer = layer;
    layer.on("tileerror", () => {
      if (tileLayer !== layer) return;
      failedTiles += 1;
      materialState.tileError = true;
      renderMaterialState();
    });
    layer.on("load", () => {
      if (tileLayer !== layer || failedTiles !== 0) return;
      materialState.tileError = false;
      renderMaterialState();
    });
    layer.addTo(map);
  }

  function initMap(lat, lon) {
    map = window.L.map("map", { zoomControl: true, attributionControl: true }).setView([lat, lon], 15);
    createTileLayer();
    marker = window.L.marker([lat, lon], { icon: pinIcon(false), zIndexOffset: 1000 }).addTo(map);
    trail = window.L.polyline([], {
      color: "#E8AD87",
      weight: 3,
      opacity: 0.85,
      dashArray: "1 10",
      lineCap: "round",
    }).addTo(map);
    window.setTimeout(() => map.invalidateSize(), 80);
  }

  function applyFreshness(timestamp) {
    if (materialState.stopped || !materialState.hasLocation) return;
    const freshness = window.LocExperience.locationFreshness(timestamp, Date.now() / 1000);
    materialState.freshness = freshness;
    document.documentElement.dataset.freshness = freshness;
    renderMaterialState();
  }

  function updateElapsedLabel() {
    if (lastTst == null) return;
    byId("last-update").querySelector("b").textContent = fmtElapsed(lastTst);
  }

  function applyState(data) {
    materialState.stopped = Boolean(data.stopped);
    byId("status-text").textContent = data.stopped ? "已停止共享" : "共享中";
    byId("status-pill").classList.toggle("stopped", data.stopped);
    document.documentElement.dataset.sharing = data.stopped ? "stopped" : "active";
    if (marker) marker.setIcon(pinIcon(data.stopped));
    if (data.stopped) {
      renderMaterialState();
      return;
    }

    if (!data.has_location || data.lat == null || data.lon == null) {
      materialState.hasLocation = false;
      materialState.freshness = "missing";
      document.documentElement.dataset.freshness = "missing";
      renderMaterialState();
      return;
    }

    materialState.hasLocation = true;
    const point = wgs2gcj(data.lat, data.lon);
    if (!map) initMap(point.lat, point.lon);
    marker.setLatLng([point.lat, point.lon]);
    trailPoints.push([point.lat, point.lon]);
    if (trailPoints.length > 120) trailPoints.shift();
    trail.setLatLngs(trailPoints);
    lastTst = data.tst;
    if (data.batt != null) byId("batt-chip").textContent = `电量 ${data.batt}%`;
    updateElapsedLabel();
    applyFreshness(data.tst);
  }

  async function performRefresh(sequence) {
    try {
      const result = await fetchWithTimeout(
        "/api/state",
        { cache: "no-store" },
        async stateResponse => ({
          response: stateResponse,
          data: stateResponse.status === 401 ? null : await stateResponse.json(),
        }),
      );
      const { response, data } = result;
      if (response.status === 401) {
        window.location.assign("/");
        return;
      }
      if (sequence < latestAppliedSequence) return;
      latestAppliedSequence = sequence;
      if (!response.ok || !data.ok) {
        materialState.apiError = true;
        renderMaterialState();
        return;
      }
      materialState.apiError = false;
      applyState(data);
    } catch (_) {
      if (sequence < latestAppliedSequence) return;
      latestAppliedSequence = sequence;
      materialState.apiError = true;
      renderMaterialState();
    }
  }

  function refresh() {
    if (refreshInFlight) return refreshInFlight;
    const sequence = ++refreshSequence;
    const request = performRefresh(sequence);
    const tracked = request.finally(() => {
      if (refreshInFlight === tracked) refreshInFlight = null;
    });
    refreshInFlight = tracked;
    return tracked;
  }

  function retryTiles() {
    if (materialState.apiError) refresh();
    if (!map || !materialState.tileError) return;
    if (tileLayer) map.removeLayer(tileLayer);
    renderMaterialState();
    createTileLayer();
  }

  function syncDocumentVisibility() {
    document.documentElement.dataset.visibility = document.hidden ? "hidden" : "visible";
  }

  window.LocMap = Object.freeze({ initMap, applyState, refresh, retryTiles });

  byId("retry-map").addEventListener("click", retryTiles);
  document.addEventListener("visibilitychange", syncDocumentVisibility);
  syncDocumentVisibility();

  window.setInterval(() => {
    updateElapsedLabel();
    if (!materialState.stopped && materialState.hasLocation && lastTst != null) {
      applyFreshness(lastTst);
    }
  }, 1000);
  refresh();
  setInterval(refresh, 10000);
})();
