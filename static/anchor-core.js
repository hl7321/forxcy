/* 原型共用逻辑：读取站点文案、访问码验证、影像列表、信件与面板。
   只依赖同源接口（/api/login、/api/state、/api/videos、/media/*），
   因此任何皮肤都能直接复用，不需要改后端。 */
(() => {
  "use strict";

  const content = () => window.LOCAPP_CONTENT || {};

  function entries() {
    const c = content();
    const entry = c.entry || {};
    return [
      {
        key: "letter",
        brand: "LETTER",
        title: entry.letterTitle || "读一封信",
        desc: entry.letterDescription || "",
      },
      {
        key: "location",
        brand: "COORD",
        title: entry.locationTitle || "查看位置",
        desc: entry.locationDescription || "",
      },
      {
        key: "videos",
        brand: "MOTION",
        title: entry.videosTitle || "看一些影像",
        desc: entry.videosDescription || "",
      },
    ];
  }

  /* 卡片位置 → 切换方向：点左边的卡就往左转一格，点右边的卡就往右转一格，中间的卡是"进入" */
  function cardStep(role) {
    if (role === "right") return 1;
    if (role === "left") return -1;
    return 0;
  }

  function letter() {
    const c = content();
    if (!c.letter) return null;
    return {
      heading: "一封信",
      opening: c.letter.opening || [],
      body: c.letter.body || [],
      closing: c.letter.closing || [],
    };
  }

  async function checkSession() {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      return response.ok;
    } catch (_) {
      return false;
    }
  }

  async function login(code) {
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok && data.ok === true, status: response.status, data };
    } catch (_) {
      return { ok: false, status: 0, data: {} };
    }
  }

  async function loadVideos() {
    try {
      const response = await fetch("/api/videos", { cache: "no-store" });
      if (!response.ok) return { ok: false, videos: [] };
      const data = await response.json();
      return { ok: true, videos: Array.isArray(data.videos) ? data.videos : [] };
    } catch (_) {
      return { ok: false, videos: [] };
    }
  }

  async function loadState() {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) return { ok: false, state: null };
      return { ok: true, state: await response.json() };
    } catch (_) {
      return { ok: false, state: null };
    }
  }

  function relativeTime(tst) {
    if (!tst) return "暂无";
    const seconds = Math.max(0, Math.round(Date.now() / 1000 - tst));
    if (seconds < 60) return "刚刚";
    if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时前`;
    return `${Math.round(seconds / 86400)} 天前`;
  }

  /* 没写文字时，用拍摄日期兜底（2026-10-04 16:40:43 → 2026.10.4） */
  function formatRecorded(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec((value || "").trim());
    if (!match) return "";
    return `${match[1]}.${Number(match[2])}.${Number(match[3])}`;
  }

  function letterLine(limit = 30) {
    const data = letter();
    if (!data) return "";
    const line = (data.opening[0] || data.body[0] || "").trim();
    return line.length > limit ? `${line.slice(0, limit)}…` : line;
  }

  /* 首屏真实内容：已登录时用真实数据更新卡片说明，未登录时标注"需要访问码" */
  async function preview() {
    const authenticated = await checkSession();
    const result = { authenticated, letterLine: letterLine(), state: null, videos: null };
    if (!authenticated) return result;
    const [stateResult, videosResult] = await Promise.all([loadState(), loadVideos()]);
    result.state = stateResult.state;
    result.videos = videosResult.videos;
    return result;
  }

  function failureHint(attempt) {
    const hints = (content().password && content().password.failureHints) || [];
    if (!hints.length) return "访问码不正确。";
    return hints[Math.min(Math.max(attempt, 1), hints.length) - 1];
  }

  /* ---------- 面板：验证码 / 信件 / 影像 ---------- */

  function createPanel(root, options = {}) {
    root.classList.add("anchor-panel");
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");

    let pending = null;
    let lastState = null;
    let attempt = 0;
    let videos = [];
    let videoIndex = 0;
    let lastFocus = null;

    function show(mode) {
      root.hidden = false;
      root.dataset.mode = mode;
      document.body.classList.add("panel-open");
      if (!lastFocus) lastFocus = document.activeElement;
      const target = root.querySelector("[data-autofocus]");
      if (target && typeof target.focus === "function") target.focus({ preventScroll: true });
    }

    function close() {
      root.hidden = true;
      document.body.classList.remove("panel-open");
      stopVideo();
      if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus({ preventScroll: true });
    }

    function stopVideo() {
      const player = root.querySelector("video");
      if (player && typeof player.pause === "function") player.pause();
    }

    /* 关闭按钮放在卡片之外：位置固定在屏幕右上角，永远可见、目标更大、不会随内容滚动跑掉 */
    function shell(inner, cardClass = "") {
      return `<button class="panel-close" type="button" aria-label="关闭面板">×</button>
        <p class="panel-dismiss-hint">点右上角 × 或空白处关闭</p>
        <div class="panel-card ${cardClass}">${inner}</div>`;
    }

    function renderGate() {
      const hint = (content().password && content().password.initialHint) || "请输入访问码。";
      root.innerHTML = `
        ${shell(`
          <p class="panel-kicker">访问码</p>
          <h2 class="panel-title">${(options.gateTitle && options.gateTitle()) || "输入访问码"}</h2>
          <p class="panel-hint">${hint}</p>
          <div class="panel-otp" role="group" aria-label="六位访问码">
            ${Array.from({ length: 6 }, (_, index) =>
              `<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1"
                      aria-label="访问码第 ${index + 1} 位" data-otp="${index}"
                      ${index === 0 ? "data-autofocus" : ""}>`).join("")}
          </div>
          <p class="panel-feedback" aria-live="polite"></p>`)}`;
      bindClose();
      const boxes = Array.from(root.querySelectorAll("[data-otp]"));
      const feedback = root.querySelector(".panel-feedback");
      boxes.forEach((box, index) => {
        box.addEventListener("input", () => {
          box.value = box.value.replace(/\D/g, "").slice(-1);
          if (box.value && boxes[index + 1]) boxes[index + 1].focus();
          if (boxes.every(item => item.value)) submit();
        });
        box.addEventListener("keydown", event => {
          if (event.key === "Backspace" && !box.value && boxes[index - 1]) {
            boxes[index - 1].value = "";
            boxes[index - 1].focus();
          }
          if (event.key === "Enter") submit();
        });
      });
      root.querySelector(".panel-otp").addEventListener("paste", event => {
        const digits = (event.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
        if (!digits) return;
        event.preventDefault();
        boxes.forEach((box, index) => { box.value = digits[index] || ""; });
        if (digits.length === 6) submit();
      });

      async function submit() {
        const code = boxes.map(box => box.value).join("");
        if (code.length !== 6) return;
        boxes.forEach(box => { box.disabled = true; });
        const result = await login(code);
        if (result.ok) {
          feedback.textContent = (content().password && content().password.success) || "验证通过";
          const action = pending;
          pending = null;
          attempt = 0;
          if (action === "videos") {
            if (typeof options.onVideos === "function") {
              close();                 // 关闭验证码面板，让整屏影像页露出来
              options.onVideos();
            } else {
              openVideos();
            }
          } else {
            const stateResult = await loadState();
            lastState = (stateResult.ok && stateResult.state) || {};
            show("location");
            renderLocation();
          }
          return;
        }
        boxes.forEach(box => { box.disabled = false; box.value = ""; });
        attempt += 1;
        feedback.textContent = result.status === 429
          ? `尝试次数过多，请 ${result.data.retry || 60} 秒后再试。`
          : failureHint(attempt);
        boxes[0].focus();
      }
    }

    function renderLetter() {
      const data = letter() || { opening: [], body: [], closing: [] };
      const paragraphs = [...data.opening, ...data.body, ...data.closing]
        .map(line => `<p>${line}</p>`).join("");
      root.innerHTML = `
        ${shell(`
          <p class="panel-kicker">LETTER</p>
          <div class="panel-letter">${paragraphs}</div>`, "panel-card--letter")}`;
      bindClose();
    }

    function renderVideos() {
      root.innerHTML = `${shell(`
          <p class="panel-kicker">MOTION</p>
          <div class="panel-video-stage" id="proto-video-stage"></div>
          <p class="panel-caption" id="proto-video-caption"></p>
          <p class="panel-video-note" id="proto-video-note" hidden></p>
          <div class="panel-video-nav" id="proto-video-nav" hidden>
            <button type="button" data-step="-1" aria-label="上一个影像">←</button>
            <span id="proto-video-counter"></span>
            <button type="button" data-step="1" aria-label="下一个影像">→</button>
          </div>
          <p class="panel-feedback" aria-live="polite" id="proto-video-feedback"></p>`, "panel-card--videos")}`;
      bindClose();
      const stage = root.querySelector("#proto-video-stage");
      const caption = root.querySelector("#proto-video-caption");
      const counter = root.querySelector("#proto-video-counter");
      const nav = root.querySelector("#proto-video-nav");
      const feedback = root.querySelector("#proto-video-feedback");
      const note = root.querySelector("#proto-video-note");

      if (!videos.length) {
        stage.innerHTML = "";
        caption.textContent = "";
        note.hidden = true;
        nav.hidden = true;
        feedback.textContent = (content().videos && content().videos.empty) || "这里还没有内容。";
        return;
      }
      feedback.textContent = "";
      const player = document.createElement("video");
      player.controls = true;
      player.preload = "metadata";
      player.playsInline = true;
      player.setAttribute("playsinline", "");
      player.setAttribute("controlslist", "nodownload noplaybackrate");
      player.disablePictureInPicture = true;
      const cards = videos.map((video, index) => {
        const wrap = document.createElement("div");
        wrap.className = "panel-video-card";
        wrap.dataset.index = String(index);
        wrap.hidden = index !== 0;
        return wrap;
      });
      stage.replaceChildren(...cards);
      let current = cards[0];
      current.appendChild(player);
      const showIndex = index => {
        const total = videos.length;
        const nextIndex = ((index % total) + total) % total;
        if (current && current !== cards[nextIndex]) {
          if (typeof player.pause === "function") player.pause();
          current.replaceChildren();
        }
        current = cards[nextIndex];
        cards.forEach((card, i) => { card.hidden = i !== nextIndex; });
        if (!current.contains(player)) current.appendChild(player);
        videoIndex = nextIndex;
        const video = videos[videoIndex];
        player.src = video.url;
        player.setAttribute("aria-label", video.title || video.name || "");
        caption.textContent = video.title || video.name || "";
        const noteText = video.caption || formatRecorded(video.recorded);
        if (noteText) {
          note.textContent = noteText;
          note.hidden = false;
        } else {
          note.textContent = "";
          note.hidden = true;
        }
        counter.textContent = `${videoIndex + 1} / ${total}`;
      };
      nav.hidden = videos.length < 2;
      nav.querySelectorAll("[data-step]").forEach(button => {
        button.addEventListener("click", () => showIndex(videoIndex + Number(button.dataset.step)));
      });
      showIndex(0);
    }

    function renderLocation() {
      const state = lastState || {};
      const rows = [
        ["最后更新", relativeTime(state.tst)],
        ["电量", state.batt != null ? `${state.batt}%` : "暂无"],
        ["坐标", state.lat != null ? `${state.lat.toFixed(5)}, ${state.lon.toFixed(5)}` : "暂无"],
      ];
      root.innerHTML = `${shell(`
          <p class="panel-kicker">COORD</p>
          <h2 class="panel-title">最近一次共享的位置</h2>
          <dl class="panel-facts">
            ${rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join("")}
          </dl>
          <p class="panel-hint">${state.stopped ? "当前已停止共享。" : "共享进行中。"}</p>
          <button class="panel-cta" id="proto-open-map" type="button">打开完整地图 →</button>`)}`;
      bindClose();
      const button = root.querySelector("#proto-open-map");
      if (button) {
        button.addEventListener("click", () => {
          if (typeof options.onLocation === "function") options.onLocation();
        });
      }
    }

    async function openVideos() {
      const authenticated = await checkSession();
      if (!authenticated) {
        pending = "videos";
        renderGate();
        show("gate");
        return;
      }
      videos = [];
      show("videos");
      root.innerHTML = shell(`<p class="panel-hint">正在加载……</p>`);
      bindClose();
      const result = await loadVideos();
      if (!result.ok) {
        root.innerHTML = shell(`<p class="panel-feedback">暂时无法加载，请稍后再试。</p>`);
        bindClose();
        return;
      }
      videos = result.videos;
      renderVideos();
      bindClose();
    }

    function openLetter() {
      renderLetter();
      show("letter");
      bindClose();
    }

    async function activate(key) {
      if (key === "letter") {
        openLetter();
        return;
      }
      if (key === "location") {
        const stateResult = await loadState();
        if (stateResult.ok) {
          lastState = stateResult.state || {};
          show("location");
          renderLocation();
          return;
        }
        pending = "location";
        renderGate();
        show("gate");
        return;
      }
      if (key === "videos") {
        if (typeof options.onVideos === "function") {
          const authenticated = await checkSession();
          if (authenticated) {
            options.onVideos();
            return;
          }
        }
        await openVideos();
      }
    }

    function bindClose() {
      const button = root.querySelector(".panel-close");
      if (button) button.addEventListener("click", close);
    }

    root.addEventListener("click", event => {
      if (event.target === root) close();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !root.hidden) close();
    });
    const closeButton = root.querySelector(".panel-close");
    if (closeButton) closeButton.addEventListener("click", close);

    return { activate, close };
  }

  window.AnchorCore = {
    entries, cardStep, letter, checkSession, login, loadVideos, loadState, preview,
    relativeTime, formatRecorded, createPanel,
  };
})();
