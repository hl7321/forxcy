---
name: 星野坐标
description: 夜色中持续存在的温暖坐标，为信件与单向位置查看提供自由而克制的入口。
colors:
  night-horizon: "#172333"
  night-mid: "#111D2A"
  night-deep: "#0C1622"
  soft-ivory: "#F2EFE9"
  muted-blue-gray: "#9FADB8"
  warm-coordinate: "#E8AD87"
  map-ground: "#DFE3E1"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "clamp(34px, 9vw, 58px)"
    fontWeight: 500
    lineHeight: 1.18
    letterSpacing: "-0.035em"
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "clamp(28px, 8vw, 42px)"
    fontWeight: 500
    letterSpacing: "-0.035em"
  action-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "clamp(18px, 5vw, 22px)"
    fontWeight: 550
    letterSpacing: "-0.02em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "16px"
    lineHeight: 1.6
  letter:
    fontFamily: '"Songti SC", "STSong", "Noto Serif CJK SC", serif'
    fontSize: "clamp(16px, 2.5vw, 19px)"
    lineHeight: 1.95
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "0.875rem"
    lineHeight: 1.45
rounded:
  quiet-state: "10px"
  control: "12px"
  map-stage: "22px"
  pill: "999px"
  coordinate: "50%"
spacing:
  compact: "8px"
  control-gap: "14px"
  control-inset: "18px"
  page-inset: "22px"
  state-inset: "24px"
components:
  entry-action-primary:
    backgroundColor: "transparent"
    textColor: "{colors.warm-coordinate}"
    typography: "{typography.action-title}"
    rounded: "0"
    padding: "18px 36px 18px 4px"
  entry-action-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.soft-ivory}"
    typography: "{typography.action-title}"
    rounded: "0"
    padding: "18px 36px 18px 4px"
  entry-action-hover:
    backgroundColor: "transparent"
    textColor: "{colors.warm-coordinate}"
  otp-field:
    backgroundColor: "rgba(255, 255, 255, 0.04)"
    textColor: "{colors.soft-ivory}"
    rounded: "{rounded.control}"
    width: "clamp(40px, 12vw, 48px)"
    height: "56px"
  otp-field-focus:
    backgroundColor: "rgba(232, 173, 135, 0.07)"
    textColor: "{colors.soft-ivory}"
    rounded: "{rounded.control}"
  map-status-pill:
    backgroundColor: "transparent"
    textColor: "{colors.soft-ivory}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  retry-button:
    backgroundColor: "{colors.warm-coordinate}"
    textColor: "{colors.night-deep}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
---

# Design System: 星野坐标

## Overview

**Creative North Star: "星野坐标"**

这不是一片用来制造浪漫奇观的星空，而是夜色中一个持续存在的坐标。深海军蓝让页面暗而不压抑，暖色锚点提供温度但不甜腻；界面把选择权留给访客，以低密度、长留白和明确路径表达自由、真诚与克制。

视觉世界从首屏方向契约向外延伸：稀疏 CSS 星点与细轨迹属于背景材料，米白文字承担内容，蓝灰文字退后，暖色坐标只标记位置、焦点、成功和少量主要动作。组件不组成玻璃卡片阵列，也不通过厚重紫色、爱心、复合暗示、霓虹、银河照片或高密闪烁来争夺注意力。

**Key Characteristics:**

- 深海军蓝夜色中的单一暖色坐标
- 移动优先、窄阅读宽度与有意留白
- 文字、细线和色调层级替代卡片堆叠
- 原生语义控件、清晰焦点和可降级动效
- refined and restrained（精致且克制）的组件表达

## Colors

调色板以三层低饱和夜色承载内容，只让一个柔和暖色成为坐标与动作信号。

### Primary

- **暖色坐标 / Warm Coordinate** (`warm-coordinate`，对应 `--anchor` 与同值的 `--focus`)：用于锚点、位置标记、清晰焦点、成功反馈和少量主要动作；它的稀缺性建立方向感。

### Neutral

- **夜幕远层 / Night Horizon** (`night-horizon`，对应 `--night-1`)：只出现在体验页渐变较亮的一端，让暗背景保有空气。
- **夜幕中层 / Night Mid** (`night-mid`，对应 `--night-2`)：连接远层与深层，也承载地图控件的深色表面。
- **夜幕深层 / Night Deep** (`night-deep`，对应 `--night-3`)：页面底色、地图功能背景及暖色按钮上的深色文字。
- **柔和米白 / Soft Ivory** (`soft-ivory`，对应 `--ink`)：主要文字、细线与位置标记边缘，避免纯白的刺眼对比。
- **静默蓝灰 / Muted Blue Gray** (`muted-blue-gray`，对应 `--muted`)：说明、次要操作、非活跃状态与阅读结尾。
- **雾灰地图 / Mist Map Ground** (`map-ground`，对应 `--map-ground`)：地图画布的低饱和基底，让暖色标记保持唯一焦点。

**The One Coordinate Rule.** 暖色坐标只承担位置、焦点、成功和少量主要动作；同一视口不制造第二个同等级亮点。

**The Night, Not Neon Rule.** 夜色靠海军蓝层次和米白对比成立，不引入纯黑、大面积紫色、霓虹蓝或照片式银河。

## Typography

**Display Font:** 系统中文无衬线栈（`display`）

**Body Font:** 系统中文无衬线栈（`body`）

**Letter Font:** 系统中文宋体栈（`letter`）

**Character:** 无衬线字体让入口、密码与地图保持直接可信；宋体只进入信件阅读场景，提供书面感而不把整个产品浪漫化。全部字体本地可用优先，不依赖远程字体加载。

### Hierarchy

- **Display** (`display`)：首屏“一个新的锚点”，只服务最重要的空间命题。
- **Headline** (`headline`)：密码页主标题，保持克制而清晰的任务起点。
- **Action Title** (`action-title`)：双入口动作标题，用字重和颜色表达主次，不放进实心卡片。
- **Body** (`body`)：状态、反馈与说明文字；关键说明保持可读的移动端字号。
- **Letter** (`letter`)：公开信正文，配合窄栏与宽松行距完成长阅读。
- **Label** (`label`)：地图副标题与状态标签，数字使用等宽数字特性保持稳定。

**The Two Voices Rule.** 宋体只用于信件正文；导航、动作、密码、状态和地图一律使用无衬线字体。

## Layout

系统以手机为主，从 `320px` 宽度开始可用。体验页是居中的单列壳，最大宽度 `680px`，移动端水平内边距 `22px`，极窄屏降为 `14px`；首屏通过纵向留白把标题、轨道与双入口组织成空间索引，而不是居中卡片。

信件栏最大宽度 `34em`，正文不超过 `68ch`；桌面端增加周围留白，不拉宽阅读行。地图在手机上使用“标题—主体—摘要”的纵向栅格，主体至少 `360px` 高；从 `800px` 起变为地图加 `280px` 摘要侧栏，地图仍是主要面积。

**The Space Before Chrome Rule.** 用留白、阅读宽度和对齐建立层级；不要为每段内容增加容器、标题条或卡片边框。

## Elevation & Depth

Elevation 采用 flat / tonal layering。默认表面保持平面，夜色三层、透明覆盖和边框对比负责分层；阴影只在暖色坐标、地图主体与位置标记等需要说明状态或空间锚定的少数位置出现。入口按钮、信件、摘要和状态文字在静止时不抬升，也不使用玻璃模糊。

### Shadow Vocabulary

- **坐标微光 / Coordinate Glow**：只围绕暖色锚点，表达它是可追踪的焦点而非装饰灯效。
- **地图承托 / Map Stage Lift**：只让大地图主体从深夜背景中分离，不复制到普通内容容器。
- **标记贴地 / Pin Grounding**：只用于地图位置标记核心，使其在灰蓝地图上保持边界。

**The Flat-by-Default Rule.** 所有普通表面静止时保持平面；阴影必须说明坐标、地图主体或当前位置的状态关系。

## Shapes

形状语言由三类曲线组成：圆形只保留给坐标点和位置标记，胶囊用于短状态与电量标签，柔和圆角用于密码格、重试按钮和地图主体。首页细轨道可以使用不对称椭圆，但它是一次性的空间线索，不是通用容器形状。按钮和文字导航通常保持无底板、无圆角，以细线和字色反馈交互。

**The Curve Has a Job Rule.** 圆与圆角必须表达坐标、状态、输入或地图边界；不要把每一段内容包成圆角卡片。

## Components

组件哲学是 refined and restrained：用原生控件、准确间距、细线和有限状态变化完成任务，不用装饰性外壳替代层级。

### Entry Actions

- **Shape:** 全宽文字动作，无底板、无圆角，底部一条低对比细线，右端以轻量箭头提示前进。
- **Primary / Secondary:** 首访主要入口使用暖色坐标，次要入口使用柔和米白；读信后只交换视觉优先级，不改变文案或可达性。
- **Hover / Focus / Active:** 支持悬停的设备将文字与细线转向暖色；键盘焦点使用全局不透明暖色轮廓；按下不增加位移或弹跳。

### Letter Navigation

- **Back:** 次要蓝灰下划线文字按钮，始终保留返回路径。
- **Continue:** 右对齐的暖色文字按钮，以短底线连接信件与位置路径。
- **States:** 悬停只改变颜色；焦点沿用全局轮廓，不使用实心按钮容器。

### OTP Fields

- **Style:** 六个独立数字格，柔和圆角、轻透明底色和低对比边框，数字居中且使用等宽数字特性。
- **Focus / Filled:** 聚焦或已填写时出现轻微暖色色调与更清晰边框；错误反馈紧邻输入组并由 `aria-live` 宣布。
- **Disabled:** 提交时保持结构不动，以透明度与不可用光标表达状态。

### Map Stage & States

- **Map Stage:** 大面积雾灰地图主体使用地图圆角，保持页面主导地位；地图图块降低饱和度、对比和亮度。
- **State Overlay:** 等待、停止和错误使用深夜透明覆盖；过期状态缩成左下角安静提示，不用卡片阵列遮挡地图。
- **Retry:** 唯一实心暖色任务按钮，悬停仅略微提亮，按下移动 `1px`，减少动态效果时取消位移。

### Status Chips & Location Summary

- **Status:** 共享状态与电量使用短胶囊、文本和圆点共同表达，颜色不是唯一信号；停止状态同时改变文字与圆点。
- **Summary:** 地址、更新时间和退出链接保持平面排版；退出链接拥有完整触控高度但不增加背景或边框。

### Location Marker

- **Coordinate:** 暖色圆芯带米白边界与一次扩散脉冲，延续首页坐标语义。
- **Stopped / Hidden:** 停止共享或页面不可见时关闭脉冲；停止状态同时将圆芯改为蓝灰。

## Do's and Don'ts

### Do:

- **Do** 让暖色坐标保持稀缺，并把它用于位置、焦点、成功和主要路径。
- **Do** 用窄阅读栏、长留白、细线和色调层级维持安静节奏。
- **Do** 保持原生语义控件、至少 `44px` 触控目标、清晰焦点与减少动态效果路径。
- **Do** 让地图继续占据页面主体，并为等待、停止、过期和错误提供材料状态。

### Don't:

- **Don't** 使用厚重紫色、爱心、复合暗示或任何要求回应的视觉压力。
- **Don't** 使用霓虹、银河照片、流星雨、高密星点或持续高频闪烁。
- **Don't** 把内容组织成玻璃卡片阵列，或给普通表面添加无意义阴影。
- **Don't** 让装饰与暖色坐标竞争，也不要只用颜色表达共享或错误状态。
