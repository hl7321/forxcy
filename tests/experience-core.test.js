const test = require("node:test");
const assert = require("node:assert/strict");
const content = require("../static/content.js");
const core = require("../static/experience-core.js");

test("confirmed copy is exact and only undecided sections stay empty", () => {
  assert.deepEqual(content.letter.opening, ["你好，这是一封示例信。", "欢迎来到这个新的锚点。"]);
  assert.deepEqual(content.letter.body, [
    "这里是一段示例正文。你可以把它替换成任何想写给访客的内容。",
    "正文内容统一放在 static/content.js 里配置，改完刷新页面即可生效。",
    "这一页只在访客主动输入访问码之后才会展示位置。",
    "示例段落：这里可以放第二段正文。",
    "示例段落：这里可以放第三段正文。",
    "示例段落：这里可以放第四段正文。",
    "示例段落：这里可以放第五段正文。",
    "示例段落：这里可以放最后一段正文。",
  ]);
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

test("the videos entry is a separate route that returns home", () => {
  assert.equal(core.nextView("entry", "OPEN_VIDEOS"), "videos");
  assert.equal(core.nextView("entry", "OPEN_VIDEOS_AUTH"), "password-idle");
  assert.equal(core.nextView("password-success", "SHOW_VIDEOS"), "videos");
  assert.equal(core.nextView("videos", "BACK"), "entry");
  assert.throws(() => core.nextView("videos", "OPEN_LETTER"), /Invalid transition/);
});

test("video switching mirrors app-card motion and honours reduced motion", () => {
  const forward = core.videoSwitchMotion(false, 1);
  assert.equal(forward.duration, 420);
  assert.match(forward.outgoingKeyframes[1].transform, /translate3d\(-18%/);
  assert.match(forward.incomingKeyframes[0].transform, /translate3d\(22%/);

  const backward = core.videoSwitchMotion(false, -1);
  assert.match(backward.outgoingKeyframes[1].transform, /translate3d\(18%/);
  assert.match(backward.incomingKeyframes[0].transform, /translate3d\(-22%/);

  const reduced = core.videoSwitchMotion(true, 1);
  assert.equal(reduced.duration, 160);
  assert.ok(reduced.incomingKeyframes.every(frame => !("transform" in frame)));
  assert.ok(reduced.outgoingKeyframes.every(frame => !("transform" in frame)));
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

test("invalid state transitions throw instead of drifting", () => {
  assert.throws(() => core.nextView("entry", "SUCCESS"), /Invalid transition/);
});

test("password success motion gathers the code while keeping feedback perceptible", () => {
  const normal = core.passwordSuccessMotion(false, 42);
  assert.equal(normal.duration, 800);
  assert.match(normal.inputKeyframes[1].transform, /translate3d\(42px, -4px, 0\)/);
  assert.equal(normal.inputKeyframes.at(-1).opacity, 0);
  assert.ok(normal.feedbackKeyframes.every((frame) => frame.opacity === 1));

  const reduced = core.passwordSuccessMotion(true, 42);
  assert.equal(reduced.duration, 180);
  assert.ok(reduced.inputKeyframes.every((frame) => !("transform" in frame)));
  assert.ok(reduced.detailKeyframes.every((frame) => !("transform" in frame)));
  assert.ok(reduced.feedbackKeyframes.every((frame) => !("transform" in frame)));
});
