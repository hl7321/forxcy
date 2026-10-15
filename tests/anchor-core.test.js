const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCore({ content } = {}) {
  const code = fs.readFileSync(path.join(__dirname, "../static/anchor-core.js"), "utf8");
  const sandbox = {
    window: content ? { LOCAPP_CONTENT: content } : {},
    document: { addEventListener() {} },
  };
  vm.runInNewContext(code, sandbox, { filename: "static/anchor-core.js" });
  return sandbox.window.AnchorCore;
}

test("a video without written text falls back to its shooting date", () => {
  const core = loadCore();
  assert.equal(core.formatRecorded("2026-10-04 16:40:43"), "2026.10.4");
  assert.equal(core.formatRecorded("2026-01-09 08:00:00"), "2026.1.9");
  assert.equal(core.formatRecorded(""), "");
  assert.equal(core.formatRecorded(undefined), "");
});

test("clicking the left card rotates left, the right card rotates right", () => {
  const core = loadCore();
  assert.equal(core.cardStep("left"), -1);
  assert.equal(core.cardStep("right"), 1);
  assert.equal(core.cardStep("center"), 0);
  assert.equal(core.cardStep(undefined), 0);
});

test("entries follow the editable site content", () => {
  const core = loadCore({
    content: {
      entry: {
        letterTitle: "读一封信",
        letterDescription: "",
        locationTitle: "查看位置",
        locationDescription: "看看我在哪里",
        videosTitle: "看一些影像",
        videosDescription: "我会持续更新的哦",
      },
    },
  });
  const entries = core.entries();
  // 注：vm 里创建的对象来自另一个 realm，先转成宿主数组再比较
  assert.deepEqual(Array.from(entries, entry => entry.key), ["letter", "location", "videos"]);
  assert.equal(entries[0].desc, "");          // 信件卡片不显示说明文字
  assert.equal(entries[1].desc, "看看我在哪里");
  assert.equal(entries[2].desc, "我会持续更新的哦");
});
