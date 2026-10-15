(() => {
  "use strict";

  const content = window.LOCAPP_CONTENT;
  const core = window.LocExperience;
  const byId = id => document.getElementById(id);
  const views = ["entry", "letter", "videos", "transition", "password"];
  const stateToView = Object.freeze({
    entry: "entry",
    letter: "letter",
    videos: "videos",
    transition: "transition",
    "password-idle": "password",
    "password-submitting": "password",
    "password-error": "password",
    "password-success": "password",
  });
  let currentState = "entry";
  let failureCount = 0;
  let lockedUntil = 0;
  let openingFlow = false;
  let authTarget = "location";
  let videoItems = [];
  let videoIndex = 0;
  let videoSwitching = false;
  let videoTouchStartX = null;
  let letterRun = 0;
  let letterPaused = false;
  let activeLetterAnimation = null;
  let activeLetterAdvance = null;
  const letterAnimations = new Set();
  const REQUEST_TIMEOUT_MS = 8000;
  const NETWORK_ERROR = "网络暂时不可用，请检查连接后重试。";

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function fetchWithTimeout(url, options = {}, consume = response => response) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(new Error("request timed out"));
      }, REQUEST_TIMEOUT_MS);
    });
    try {
      const requestOptions = controller ? { ...options, signal: controller.signal } : options;
      const request = fetch(url, requestOptions).then(consume);
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function animateSafely(element, keyframes, timing) {
    const fallbackDuration = Number(timing.duration) || 0;
    try {
      if (!element || typeof element.animate !== "function") {
        await wait(fallbackDuration);
        return;
      }
      const animation = element.animate(keyframes, timing);
      if (!animation || !animation.finished || typeof animation.finished.then !== "function") {
        await wait(fallbackDuration);
        return;
      }
      await animation.finished;
    } catch (_) {
      await wait(fallbackDuration);
    }
  }

  function appendParagraphs(target, lines) {
    target.replaceChildren(...lines.map(line => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    }));
    target.hidden = lines.length === 0;
  }

  function renderContent() {
    byId("entry-title").textContent = content.entry.greeting;
    document.querySelector('[data-copy="letter-title"]').textContent = content.entry.letterTitle;
    document.querySelector('[data-copy="letter-description"]').textContent = content.entry.letterDescription;
    document.querySelector('[data-copy="location-title"]').textContent = content.entry.locationTitle;
    document.querySelector('[data-copy="location-description"]').textContent = content.entry.locationDescription;
    document.querySelector('[data-copy="videos-title"]').textContent = content.entry.videosTitle;
    document.querySelector('[data-copy="videos-description"]').textContent = content.entry.videosDescription;
    appendParagraphs(byId("letter-opening"), content.letter.opening);
    appendParagraphs(byId("letter-body"), content.letter.body);
    appendParagraphs(byId("letter-closing"), content.letter.closing);
    appendParagraphs(byId("transition-copy"), content.transition.lines);
    byId("password-hint").textContent = content.password.initialHint;
  }

  function setLetterMode(mode) {
    byId("view-letter").dataset.letterMode = mode;
    byId("letter-pause").textContent = mode === "paused" ? "继续" : "暂停";
    byId("letter-full").textContent = mode === "full" ? "重新播放字幕" : "阅读全文";
  }

  function stopLetterPlayback(mode) {
    letterRun += 1;
    letterPaused = false;
    if (activeLetterAdvance) activeLetterAdvance.resolve();
    activeLetterAdvance = null;
    for (const animation of letterAnimations) {
      if (animation && typeof animation.cancel === "function") {
        animation.cancel();
      }
    }
    letterAnimations.clear();
    activeLetterAnimation = null;
    if (mode) setLetterMode(mode);
  }

  function captionDuration(text) {
    return Math.min(8500, Math.max(5500, 2600 + text.length * 85));
  }

  async function startLetterPlayback() {
    stopLetterPlayback();
    const paragraphs = Array.from(byId("letter-body").children);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || paragraphs.length === 0 || typeof paragraphs[0].animate !== "function") {
      setLetterMode("full");
      return;
    }

    const run = ++letterRun;
    setLetterMode("playing");
    for (const paragraph of paragraphs) {
      if (run !== letterRun) return;
      let advance;
      try {
        const duration = captionDuration(paragraph.textContent);
        activeLetterAnimation = paragraph.animate([
          { opacity: 0, filter: "blur(6px)", offset: 0 },
          { opacity: 1, filter: "blur(0)", offset: 0.14, easing: "cubic-bezier(.16,1,.3,1)" },
          { opacity: 1, filter: "blur(0)", offset: 0.84 },
          { opacity: 0, filter: "blur(4px)", offset: 1, easing: "ease-in" },
        ], {
          duration,
          easing: "linear",
          fill: "both",
        });
        letterAnimations.add(activeLetterAnimation);
        if (letterPaused && typeof activeLetterAnimation.pause === "function") {
          activeLetterAnimation.pause();
        }
        advance = {};
        advance.promise = new Promise(resolve => { advance.resolve = resolve; });
        activeLetterAdvance = advance;
        const finished = activeLetterAnimation.finished;
        const completion = finished && typeof finished.then === "function"
          ? finished
          : wait(duration);
        await Promise.race([completion, advance.promise]);
      } catch (_) {
        if (run !== letterRun) return;
      } finally {
        if (activeLetterAdvance === advance) activeLetterAdvance = null;
      }
    }
    if (run !== letterRun) return;
    activeLetterAnimation = null;
    setLetterMode("complete");
  }

  function toggleLetterPause() {
    if (!activeLetterAnimation) return;
    letterPaused = !letterPaused;
    if (letterPaused && typeof activeLetterAnimation.pause === "function") {
      activeLetterAnimation.pause();
      setLetterMode("paused");
    } else if (!letterPaused && typeof activeLetterAnimation.play === "function") {
      activeLetterAnimation.play();
      setLetterMode("playing");
    }
  }

  function advanceLetterCaption() {
    if (byId("view-letter").dataset.letterMode !== "playing") return;
    if (!activeLetterAnimation || !activeLetterAdvance) return;
    if (typeof activeLetterAnimation.finish === "function") {
      try {
        activeLetterAnimation.finish();
      } catch (_) {
        // The independent advance signal below still moves to the next caption.
      }
    }
    activeLetterAdvance.resolve();
  }

  function toggleFullLetter() {
    if (byId("view-letter").dataset.letterMode === "full") {
      startLetterPlayback();
    } else {
      stopLetterPlayback("full");
    }
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

  function applyEntryPriority() {
    const seen = localStorage.getItem("letter_seen") === "true";
    const priority = core.entryPriority(seen);
    byId("open-letter").dataset.priority = priority.primary === "letter" ? "primary" : "secondary";
    byId("open-location").dataset.priority = priority.primary === "location" ? "primary" : "secondary";
  }

  function markLetterSeen() {
    localStorage.setItem("letter_seen", "true");
    applyEntryPriority();
  }

  function letterEndIsVisible() {
    if (currentState !== "letter") return false;
    const rect = byId("letter-continue").getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    return rect.bottom > 0 && rect.bottom <= viewportHeight;
  }

  function setupLetterSeenTracking() {
    const end = byId("letter-continue");
    if (typeof IntersectionObserver === "function") {
      const observer = new IntersectionObserver(entries => {
        if (currentState === "letter" && entries.some(entry => entry.target === end && entry.isIntersecting)) {
          markLetterSeen();
        }
      });
      observer.observe(end);
      return;
    }
    const checkEnd = () => {
      if (letterEndIsVisible()) markLetterSeen();
    };
    window.addEventListener("scroll", checkEnd, { passive: true });
    window.addEventListener("resize", checkEnd);
  }

  function showState(nextState, { focus = true } = {}) {
    const nextView = stateToView[nextState];
    views.forEach(name => { byId(`view-${name}`).hidden = name !== nextView; });
    currentState = nextState;
    byId("experience-shell").dataset.state = nextState;
    byId("view-password").setAttribute("aria-busy", String(nextState === "password-submitting"));
    if (nextState === "letter" && letterEndIsVisible()) markLetterSeen();
    if (!focus) return;
    const target = byId(`view-${nextView}`).querySelector("button, input, [href], h1");
    if (target) target.focus({ preventScroll: true });
  }

  function move(event, options) {
    showState(core.nextView(currentState, event), options);
  }

  async function checkExistingSession() {
    try {
      const response = await fetchWithTimeout("/api/state", { cache: "no-store" });
      return { authenticated: response.ok, networkError: false };
    } catch (_) {
      return { authenticated: false, networkError: true };
    }
  }

  async function openLocation({ fromLetter = false } = {}) {
    if (openingFlow) return;
    openingFlow = true;
    try {
      const session = await checkExistingSession();
      if (fromLetter) markLetterSeen();
      if (fromLetter) {
        move("CONTINUE", { focus: false });
        await runLetterTransition();
      }
      if (session.authenticated) {
        window.location.assign("/map");
        return;
      }
      setPasswordContext("location");
      if (fromLetter) move("COMPLETE");
      else move("OPEN_LOCATION");
      if (session.networkError) byId("password-feedback").textContent = NETWORK_ERROR;
    } finally {
      openingFlow = false;
    }
  }

  function setPasswordContext(target) {
    authTarget = target;
    byId("password-title").textContent = target === "videos"
      ? content.videos.title
      : content.password.locationTitle;
    byId("password-hint").textContent = content.password.initialHint;
    byId("password-feedback").textContent = "";
  }

  function formatVideoSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return "";
    const megabytes = value / (1024 * 1024);
    if (megabytes >= 1) return `${megabytes.toFixed(1)} MB`;
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  function stopVideoPlayback() {
    const list = byId("video-list");
    if (!list || typeof list.querySelectorAll !== "function") return;
    list.querySelectorAll("video").forEach(player => {
      if (player && typeof player.pause === "function") player.pause();
    });
  }

  function renderVideos(videos) {
    const list = byId("video-list");
    const feedback = byId("videos-feedback");
    videoItems = videos;
    videoIndex = 0;
    if (!videos.length) {
      list.replaceChildren();
      byId("video-controls").hidden = true;
      byId("video-caption").textContent = "";
      byId("video-counter").textContent = "";
      feedback.textContent = content.videos.empty;
      return;
    }
    feedback.textContent = "";
    list.replaceChildren(...videos.map((video, index) => {
      const card = document.createElement("article");
      card.className = "video-card";
      card.dataset.index = String(index);
      const player = document.createElement("video");
      player.controls = true;
      player.preload = "metadata";
      player.playsInline = true;
      player.setAttribute("playsinline", "");
      player.setAttribute("controlslist", "nodownload");
      player.src = video.url;
      const title = video.title || video.name || "";
      player.setAttribute("aria-label", title);
      player.addEventListener("loadedmetadata", () => {
        if (player.videoWidth && player.videoHeight && player.style) {
          player.style.aspectRatio = `${player.videoWidth} / ${player.videoHeight}`;
        }
      });
      card.replaceChildren(player);
      card.hidden = index !== 0;
      return card;
    }));
    byId("video-controls").hidden = videos.length < 2;
    updateVideoCaption();
  }

  function videoLabel(video) {
    const title = video.title || video.name || "";
    const size = formatVideoSize(video.size);
    return size ? `${title} · ${size}` : title;
  }

  function updateVideoCaption() {
    const video = videoItems[videoIndex];
    byId("video-caption").textContent = video ? videoLabel(video) : "";
    byId("video-counter").textContent = videoItems.length
      ? `${videoIndex + 1} / ${videoItems.length}`
      : "";
  }

  function pauseCard(card) {
    if (!card || typeof card.querySelector !== "function") return;
    const player = card.querySelector("video");
    if (player && typeof player.pause === "function") player.pause();
  }

  async function switchVideo(step) {
    const cards = Array.from(byId("video-list").children);
    if (cards.length < 2 || videoSwitching) return;
    const total = cards.length;
    const nextIndex = ((videoIndex + step) % total + total) % total;
    if (nextIndex === videoIndex) return;
    const outgoing = cards[videoIndex];
    const incoming = cards[nextIndex];
    videoSwitching = true;
    pauseCard(outgoing);
    incoming.hidden = false;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = core.videoSwitchMotion(reduce, step);
    const timing = {
      duration: motion.duration,
      easing: "cubic-bezier(.16,1,.3,1)",
      fill: "both",
    };
    videoIndex = nextIndex;
    updateVideoCaption();
    await Promise.all([
      animateSafely(incoming, motion.incomingKeyframes, timing),
      animateSafely(outgoing, motion.outgoingKeyframes, timing),
    ]);
    outgoing.hidden = true;
    videoSwitching = false;
  }

  async function loadVideos() {
    const feedback = byId("videos-feedback");
    feedback.textContent = content.videos.loading;
    try {
      const result = await fetchWithTimeout("/api/videos", { cache: "no-store" },
        async videosResponse => ({
          response: videosResponse,
          data: await videosResponse.json(),
        }));
      if (!result.response.ok || !result.data.ok || !Array.isArray(result.data.videos)) {
        throw new Error("unexpected videos response");
      }
      renderVideos(result.data.videos);
    } catch (_) {
      byId("video-list").replaceChildren();
      feedback.textContent = content.videos.error;
    }
  }

  async function openVideos() {
    if (openingFlow) return;
    openingFlow = true;
    try {
      const session = await checkExistingSession();
      if (session.authenticated) {
        move("OPEN_VIDEOS");
        await loadVideos();
        return;
      }
      setPasswordContext("videos");
      move("OPEN_VIDEOS_AUTH");
      if (session.networkError) byId("password-feedback").textContent = NETWORK_ERROR;
    } finally {
      openingFlow = false;
    }
  }

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
    await animateSafely(anchor, keyframes, {
      duration,
      easing: "cubic-bezier(.16,1,.3,1)",
      fill: "both",
    });
  }

  async function runPasswordSuccessTransition(boxes) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const otpRect = byId("otp").getBoundingClientRect();
    const gatherTarget = otpRect.left + otpRect.width / 2;
    const motion = core.passwordSuccessMotion(reduce, 0);
    const timing = {
      duration: motion.duration,
      easing: "cubic-bezier(.16,1,.3,1)",
      fill: "forwards",
    };
    const animations = boxes.map(box => {
      const boxRect = box.getBoundingClientRect();
      const boxCenter = boxRect.left + boxRect.width / 2;
      const frames = core.passwordSuccessMotion(reduce, gatherTarget - boxCenter).inputKeyframes;
      return animateSafely(box, frames, timing);
    });
    for (const detail of [byId("password-back"), byId("password-title"), byId("password-hint")]) {
      animations.push(animateSafely(detail, motion.detailKeyframes, timing));
    }
    animations.push(animateSafely(byId("password-feedback"), motion.feedbackKeyframes, timing));
    await Promise.all(animations);
  }

  function otpValue(boxes) {
    return boxes.map(box => box.value).join("");
  }

  function clearOtp(boxes) {
    boxes.forEach(box => {
      box.value = "";
      box.disabled = false;
      box.classList.remove("filled");
    });
    boxes[0].focus();
  }

  async function submitCode(boxes) {
    if (Date.now() < lockedUntil || currentState === "password-submitting" || currentState === "password-success") return;
    const code = otpValue(boxes);
    if (code.length !== 6) {
      byId("password-feedback").textContent = "请输入完整的六位访问码。";
      return;
    }
    move("SUBMIT", { focus: false });
    boxes.forEach(box => { box.disabled = true; });
    let response;
    let data;
    try {
      const result = await fetchWithTimeout("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }, async loginResponse => ({
        response: loginResponse,
        data: await loginResponse.json(),
      }));
      response = result.response;
      data = result.data;
    } catch (_) {
      move("FAIL", { focus: false });
      boxes.forEach(box => { box.disabled = false; });
      byId("password-feedback").textContent = NETWORK_ERROR;
      return;
    }
    if (response.ok && data.ok) {
      move("SUCCESS", { focus: false });
      byId("password-feedback").textContent = content.password.success;
      document.documentElement.dataset.auth = "success";
      await runPasswordSuccessTransition(boxes);
      if (authTarget === "videos") {
        delete document.documentElement.dataset.auth;
        move("SHOW_VIDEOS");
        await loadVideos();
        return;
      }
      window.location.assign("/map");
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
  }

  function bindOtp(boxes) {
    boxes.forEach((box, index) => {
      box.addEventListener("input", () => {
        box.value = box.value.replace(/\D/g, "").slice(-1);
        box.classList.toggle("filled", box.value !== "");
        if (box.value && boxes[index + 1]) boxes[index + 1].focus();
        if (otpValue(boxes).length === boxes.length) submitCode(boxes);
      });
      box.addEventListener("keydown", event => {
        if (event.key === "Backspace" && box.value === "" && boxes[index - 1]) {
          event.preventDefault();
          boxes[index - 1].value = "";
          boxes[index - 1].classList.remove("filled");
          boxes[index - 1].focus();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          submitCode(boxes);
        }
      });
    });

    byId("otp").addEventListener("paste", event => {
      const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
      if (!digits) return;
      event.preventDefault();
      boxes.forEach((box, index) => {
        box.value = digits[index] || "";
        box.classList.toggle("filled", box.value !== "");
      });
      boxes[Math.min(digits.length, boxes.length) - 1].focus();
      if (digits.length === boxes.length) submitCode(boxes);
    });
  }

  function bindControls(boxes) {
    byId("open-letter").addEventListener("click", () => {
      if (!openingFlow) {
        move("OPEN_LETTER");
        startLetterPlayback();
      }
    });
    byId("open-location").addEventListener("click", () => openLocation());
    byId("open-videos").addEventListener("click", () => { openVideos(); });
    byId("videos-back").addEventListener("click", () => {
      stopVideoPlayback();
      move("BACK");
    });
    byId("video-prev").addEventListener("click", () => { switchVideo(-1); });
    byId("video-next").addEventListener("click", () => { switchVideo(1); });
    const stage = byId("video-stage");
    stage.addEventListener("touchstart", event => {
      const touch = event.changedTouches && event.changedTouches[0];
      videoTouchStartX = touch ? touch.clientX : null;
    }, { passive: true });
    stage.addEventListener("touchend", event => {
      const touch = event.changedTouches && event.changedTouches[0];
      if (videoTouchStartX === null || !touch) return;
      const delta = touch.clientX - videoTouchStartX;
      videoTouchStartX = null;
      if (Math.abs(delta) > 40) switchVideo(delta < 0 ? 1 : -1);
    });
    window.addEventListener("keydown", event => {
      if (currentState !== "videos") return;
      if (event.key === "ArrowLeft") {
        if (event.preventDefault) event.preventDefault();
        switchVideo(-1);
      } else if (event.key === "ArrowRight") {
        if (event.preventDefault) event.preventDefault();
        switchVideo(1);
      }
    });
    byId("letter-back").addEventListener("click", () => {
      if (!openingFlow) {
        stopLetterPlayback("full");
        move("BACK");
      }
    });
    byId("letter-pause").addEventListener("click", toggleLetterPause);
    byId("letter-full").addEventListener("click", toggleFullLetter);
    byId("letter-body").addEventListener("click", advanceLetterCaption);
    byId("letter-continue").addEventListener("click", () => {
      stopLetterPlayback("full");
      openLocation({ fromLetter: true });
    });
    byId("password-back").addEventListener("click", () => {
      if (currentState === "password-idle" || currentState === "password-error") {
        move("BACK");
        applyEntryPriority();
      }
    });
    bindOtp(boxes);
  }

  renderContent();
  const boxes = buildOtp();
  applyEntryPriority();
  showState("entry", { focus: false });
  bindControls(boxes);
  setupLetterSeenTracking();
})();
