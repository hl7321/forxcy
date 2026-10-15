(() => {
  "use strict";

  const core = window.AnchorCore;
  const content = window.LOCAPP_CONTENT || {};
  const items = core.entries();
  const descs = items.map(item => item.desc);
  const palettes = [
    { bg: "#EE8765", stage: "#FEF7EA", glyph: "LETTER" },
    { bg: "#6EBC7C", stage: "#F4FEF3", glyph: "LOCATION" },
    { bg: "#E486B4", stage: "#FFF4F9", glyph: "VIDEO" },
  ];
  const washes = [];

  let index = 0;
  let locked = false;
  let touchStartX = null;

  const carousel = document.getElementById("carousel");
  const ghost = document.getElementById("ghost");
  const panelRoot = document.getElementById("panel");
  const backdrop = document.getElementById("backdrop");
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const videosView = document.getElementById("view-videos");
  const videosStage = document.getElementById("videos-stage");
  const videosNote = document.getElementById("videos-note");
  const videosFeedback = document.getElementById("videos-feedback");
  const videosCounter = document.getElementById("videos-counter");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let videoData = [];
  let videoCards = [];
  let activeVideo = 0;

  document.querySelector(".brand").firstChild.textContent =
    (content.entry && content.entry.greeting) || "一个新的锚点";

  /* 每个入口一层彩色光晕，切换时交叉淡入淡出；四边留给恒定底色 */
  palettes.forEach(palette => {
    const wash = document.createElement("div");
    wash.className = "wash";
    wash.setAttribute("aria-hidden", "true");
    wash.style.background = palette.bg;
    document.body.insertBefore(wash, document.querySelector(".backdrop").nextSibling);
    washes.push(wash);
  });

  const figures = items.map((item, position) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "figure";
    node.setAttribute("aria-label", item.desc ? `${item.title}：${item.desc}` : item.title);
    const description = descs[position] ? `<p>${descs[position]}</p>` : "";
    node.innerHTML = `
      <span class="glyph" aria-hidden="true">${palettes[position].glyph}</span>
      <span>
        <h3>${item.title}</h3>
        ${description}
      </span>`;
    node.addEventListener("click", () => {
      const direction = core.cardStep(node.dataset.role);
      if (direction === 0) enter();
      else step(direction);
    });
    carousel.appendChild(node);
    return node;
  });

  const panel = core.createPanel(panelRoot, {
    gateTitle: () => "输入访问码",
    onLocation: () => window.location.assign("/map"),
    onVideos: () => { openVideosView(); },
  });

  /* ---------- 整屏影像页（纵深轮播：只显示三张，左右可滑可兜回） ---------- */

  const VIDEOS_SHIFT = 520;
  let videoLocked = false;
  let videoTouchX = null;
  let videoDragDelta = 0;

  function pauseVideos() {
    videosStage.querySelectorAll("video").forEach(player => {
      if (typeof player.pause === "function") player.pause();
    });
  }

  /* 位置 → 角色：中间、右边、左边各一张，其余藏起来（但仍在环形序列里） */
  function roleForVideo(position) {
    const total = videoCards.length;
    if (!total) return "back";
    const diff = (position - activeVideo + total) % total;
    if (diff === 0) return "center";
    if (diff === 1) return "right";
    if (diff === total - 1) return "left";
    return "back";
  }

  function renderVideoRoles() {
    videoCards.forEach((card, position) => {
      card.dataset.role = roleForVideo(position);
    });
    updateActiveVideo();
  }

  function stepVideo(delta) {
    if (videoLocked || videoCards.length < 2) return;
    videoLocked = true;
    pauseVideos();
    activeVideo = ((activeVideo + delta) % videoCards.length + videoCards.length) % videoCards.length;
    renderVideoRoles();
    setTimeout(() => { videoLocked = false; }, VIDEOS_SHIFT);
  }

  function updateActiveVideo() {
    const video = videoData[activeVideo];
    const text = video ? (video.caption || core.formatRecorded(video.recorded)) : "";
    if (text) {
      videosNote.textContent = text;
      videosNote.hidden = false;
    } else {
      videosNote.textContent = "";
      videosNote.hidden = true;
    }
    videosCounter.textContent = videoCards.length ? `${activeVideo + 1} / ${videoCards.length}` : "";
  }

  async function openVideosView() {
    videosView.hidden = false;
    videosStage.replaceChildren();
    videosNote.hidden = true;
    videosCounter.textContent = "";
    videosFeedback.textContent = "正在加载……";
    activeVideo = 0;

    const result = await core.loadVideos();
    if (!result.ok) {
      videosFeedback.textContent = "暂时无法加载，请稍后再试。";
      return;
    }
    if (!result.videos.length) {
      videosFeedback.textContent = "这里还没有内容。";
      return;
    }
    videosFeedback.textContent = "";
    videoData = result.videos;
    videoCards = result.videos.map((video, index) => {
      const card = document.createElement("article");
      card.className = "videos-card";
      const player = document.createElement("video");
      player.controls = true;
      player.preload = "metadata";
      player.playsInline = true;
      player.setAttribute("playsinline", "");
      player.setAttribute("controlslist", "nodownload noplaybackrate");
      player.disablePictureInPicture = true;
      player.src = video.url;
      player.setAttribute("aria-label", video.title || video.name || "");
      const note = video.caption || core.formatRecorded(video.recorded);
      if (note) player.title = note;
      card.appendChild(player);
      card.addEventListener("click", () => {
        const direction = core.cardStep(card.dataset.role);
        if (direction === 0) return;          // 中间那条交给播放器自己的控件
        stepVideo(direction);                 // 点左边往左转，点右边往右转
      });
      return card;
    });
    videosStage.replaceChildren(...videoCards);
    renderVideoRoles();

    /* 入场：卡片依次浮现 */
    videoCards.forEach((card, index) => {
      if (reduceMotion) card.classList.add("in");
      else setTimeout(() => card.classList.add("in"), 70 + index * 70);
    });
  }

  function closeVideosView() {
    pauseVideos();
    videosView.hidden = true;
  }

  /* 跟手拖动：按下开始、移动时卡片跟着走、松手按距离决定切换或回弹 */
  function setDrag(px) {
    videosStage.style.setProperty("--drag", `${px}px`);
  }

  function resetDrag() {
    videosStage.classList.remove("dragging");
    setDrag(0);
    videoTouchX = null;
    videoDragDelta = 0;
  }

  videosStage.addEventListener("pointerdown", event => {
    if (videosView.hidden || videoCards.length < 2) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    videoTouchX = event.clientX;
    videoDragDelta = 0;
    if (typeof videosStage.setPointerCapture === "function") {
      try { videosStage.setPointerCapture(event.pointerId); } catch (_) { /* 忽略 */ }
    }
  });

  videosStage.addEventListener("pointermove", event => {
    if (videoTouchX === null) return;
    videoDragDelta = event.clientX - videoTouchX;
    if (!videosStage.classList.contains("dragging") && Math.abs(videoDragDelta) > 6) {
      videosStage.classList.add("dragging");
      pauseVideos();
    }
    if (videosStage.classList.contains("dragging")) {
      setDrag(videoDragDelta * 0.92);        // 轻微阻尼，手感更顺
    }
  });

  function finishVideoDrag() {
    if (videoTouchX === null) return;
    const delta = videoDragDelta;
    const wasDragging = videosStage.classList.contains("dragging");
    const width = videoCards[0] ? videoCards[0].getBoundingClientRect().width : 280;
    const threshold = Math.max(44, width * 0.16);
    resetDrag();
    if (wasDragging && Math.abs(delta) > threshold) {
      stepVideo(delta < 0 ? 1 : -1);         // 左滑看下一条，右滑看上一条
    }
  }

  videosStage.addEventListener("pointerup", finishVideoDrag);
  videosStage.addEventListener("pointercancel", finishVideoDrag);

  document.getElementById("videos-back").addEventListener("click", closeVideosView);

  function roleOf(position) {
    const total = figures.length;
    const diff = (position - index + total) % total;
    return diff === 0 ? "center" : diff === 1 ? "right" : "left";
  }

  function render(animate) {
    const palette = palettes[index];
    /* 最外圈保持恒定底色；颜色只在中间的"光晕"层里切换（交叉淡入淡出） */
    washes.forEach((wash, position) => {
      wash.classList.toggle("is-active", position === index);
    });
    if (themeColor) themeColor.setAttribute("content", "#FBF3E7");
    figures.forEach((node, position) => {
      node.dataset.role = roleOf(position);
      node.style.setProperty("--stage", palettes[position].stage);
      node.querySelector(".glyph").style.backgroundImage =
        `linear-gradient(180deg, rgba(255, 255, 255, .4), ${palettes[position].bg})`;
    });
    ghost.textContent = items[index].brand;
    document.getElementById("copy-title").textContent = items[index].title;
    const descNode = document.getElementById("copy-desc");
    descNode.textContent = descs[index] || "";
    descNode.hidden = !descs[index];
    document.getElementById("counter").textContent = `${index + 1} / ${items.length}`;
    if (animate && typeof document.getElementById("copy-title").animate === "function") {
      document.getElementById("copy-title").animate(
        [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
        { duration: 380, easing: "cubic-bezier(.22,.61,.36,1)" },
      );
    }
  }

  function step(delta) {
    if (locked) return;
    locked = true;
    index = ((index + delta) % items.length + items.length) % items.length;
    render(delta);
    setTimeout(() => { locked = false; }, 650);
  }

  function enter() {
    panel.activate(items[index].key);
  }

  document.getElementById("prev").addEventListener("click", () => step(-1));
  document.getElementById("next").addEventListener("click", () => step(1));
  document.getElementById("enter").addEventListener("click", enter);

  window.addEventListener("keydown", event => {
    if (!videosView.hidden) {
      if (event.key === "Escape") closeVideosView();
      else if (event.key === "ArrowLeft") stepVideo(-1);
      else if (event.key === "ArrowRight") stepVideo(1);
      return;
    }
    if (!panelRoot.hidden) return;              // 面板打开时不切换卡片
    if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "ArrowRight") step(1);
    else if (event.key === "Enter") enter();
  });

  carousel.addEventListener("touchstart", event => {
    touchStartX = event.changedTouches[0].clientX;
  }, { passive: true });
  carousel.addEventListener("touchend", event => {
    if (touchStartX === null) return;
    const delta = event.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(delta) > 40) step(delta < 0 ? 1 : -1);
  });

  render(false);

  /* 诊断模式：/new?debug=1 —— 在手机上把真实尺寸与颜色显示出来，便于定位显示问题 */
  if (new URLSearchParams(window.location.search).has("debug")) {
    const readout = document.createElement("pre");
    readout.className = "debug-readout";
    document.body.appendChild(readout);
    const update = () => {
      const style = getComputedStyle(document.documentElement);
      readout.textContent = [
        `innerHeight=${window.innerHeight} visualViewport=${window.visualViewport ? Math.round(window.visualViewport.height) : "n/a"}`,
        `screen=${screen.width}x${screen.height} dpr=${window.devicePixelRatio}`,
        `html.clientHeight=${document.documentElement.clientHeight} body.height=${Math.round(document.body.getBoundingClientRect().height)}`,
        `stage.height=${Math.round(document.querySelector(".stage").getBoundingClientRect().height)}`,
        `safe-area top=${style.getPropertyValue("--sat") || "n/a"}`,
        `html背景=${getComputedStyle(document.documentElement).backgroundColor}`,
        `backdrop背景=${getComputedStyle(document.getElementById("backdrop")).backgroundColor}`,
        `theme-color=${(document.querySelector('meta[name="theme-color"]') || {}).content || "无"}`,
        `standalone=${window.navigator.standalone === true} 屏幕方向=${screen.orientation ? screen.orientation.type : "n/a"}`,
      ].join("\n");
    };
    update();
    setInterval(update, 1500);
  }
})();
