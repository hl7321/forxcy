(function (root, factory) {
  const content = factory();
  if (typeof module === "object" && module.exports) module.exports = content;
  else root.LOCAPP_CONTENT = content;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return Object.freeze({
    entry: Object.freeze({
      greeting: "一个新的锚点",
      letterTitle: "读一封信",
      letterDescription: "",
      locationTitle: "查看位置",
      locationDescription: "看看我在哪里",
      videosTitle: "看一些影像",
      videosDescription: "我会持续更新的哦",
    }),
    videos: Object.freeze({
      loading: "正在加载……",
      empty: "这里还没有内容。",
      error: "暂时无法加载，请稍后再试。",
    }),
    letter: Object.freeze({
      opening: Object.freeze(["你好，这是一封示例信。", "欢迎来到这个新的锚点。"]),
      body: Object.freeze([
        "这里是一段示例正文。你可以把它替换成任何想写给访客的内容。",
        "正文内容统一放在 static/content.js 里配置，改完刷新页面即可生效。",
        "这一页只在访客主动输入访问码之后才会展示位置。",
        "示例段落：这里可以放第二段正文。",
        "示例段落：这里可以放第三段正文。",
        "示例段落：这里可以放第四段正文。",
        "示例段落：这里可以放第五段正文。",
        "示例段落：这里可以放最后一段正文。",
      ]),
      closing: Object.freeze([
        "这里只会展示站主的位置，不会获取访客的定位，所以站主看不到你在哪里。",
        "访客打开这个页面时，站主不会收到任何通知。",
        "这个站点主要用于演示单向位置分享。",
      ]),
    }),
    transition: Object.freeze({ lines: Object.freeze([]) }),
    password: Object.freeze({
      locationTitle: "查看位置",
      videosTitle: "看一些影像",
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
