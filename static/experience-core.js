(function (root, factory) {
  const core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  else root.LocExperience = core;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
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

  function passwordSuccessMotion(reduce, gatherX) {
    if (reduce) {
      return {
        duration: 180,
        inputKeyframes: [{ opacity: 1 }, { opacity: 0.35 }],
        detailKeyframes: [{ opacity: 1 }, { opacity: 0.45 }],
        feedbackKeyframes: [{ opacity: 1 }, { opacity: 1 }],
      };
    }
    return {
      duration: 800,
      inputKeyframes: [
        { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1, offset: 0 },
        { transform: `translate3d(${gatherX}px, -4px, 0) scale(.68)`, opacity: 0.9, offset: 0.68 },
        { transform: `translate3d(${gatherX}px, -8px, 0) scale(.2)`, opacity: 0, offset: 1 },
      ],
      detailKeyframes: [
        { transform: "translateY(0)", opacity: 1 },
        { transform: "translateY(-6px)", opacity: 0.25 },
      ],
      feedbackKeyframes: [
        { transform: "translateY(6px)", opacity: 1 },
        { transform: "translateY(0)", opacity: 1 },
      ],
    };
  }

  function videoSwitchMotion(reduce, direction) {
    const step = direction < 0 ? -1 : 1;
    if (reduce) {
      return {
        duration: 160,
        outgoingKeyframes: [{ opacity: 1 }, { opacity: 0 }],
        incomingKeyframes: [{ opacity: 0 }, { opacity: 1 }],
      };
    }
    return {
      duration: 420,
      outgoingKeyframes: [
        { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1, offset: 0 },
        { transform: `translate3d(${-18 * step}%, 0, 0) scale(.88)`, opacity: 0, offset: 1 },
      ],
      incomingKeyframes: [
        { transform: `translate3d(${22 * step}%, 0, 0) scale(.88)`, opacity: 0, offset: 0 },
        { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1, offset: 1 },
      ],
    };
  }

  const transitions = Object.freeze({
    entry: Object.freeze({
      OPEN_LETTER: "letter",
      OPEN_LOCATION: "password-idle",
      OPEN_VIDEOS: "videos",
      OPEN_VIDEOS_AUTH: "password-idle",
    }),
    letter: Object.freeze({ BACK: "entry", CONTINUE: "transition" }),
    videos: Object.freeze({ BACK: "entry" }),
    transition: Object.freeze({ COMPLETE: "password-idle" }),
    "password-idle": Object.freeze({ BACK: "entry", SUBMIT: "password-submitting" }),
    "password-error": Object.freeze({ BACK: "entry", SUBMIT: "password-submitting" }),
    "password-submitting": Object.freeze({ FAIL: "password-error", SUCCESS: "password-success" }),
    "password-success": Object.freeze({ SHOW_VIDEOS: "videos" }),
  });

  function nextView(current, event) {
    const next = transitions[current] && transitions[current][event];
    if (!next) throw new Error(`Invalid transition: ${current} -> ${event}`);
    return next;
  }

  return Object.freeze({
    entryPriority,
    failureHint,
    locationFreshness,
    nextView,
    passwordSuccessMotion,
    videoSwitchMotion,
  });
});
