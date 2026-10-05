import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StaticContractTest(unittest.TestCase):
    def read(self, relative):
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_entry_has_four_named_views_and_native_controls(self):
        html = self.read("static/index.html")
        for view_id in ("view-entry", "view-letter", "view-transition", "view-password"):
            self.assertIn(f'id="{view_id}"', html)
        for control_id in (
            "open-letter",
            "open-location",
            "letter-back",
            "letter-pause",
            "letter-full",
            "letter-continue",
            "password-back",
        ):
            self.assertRegex(html, rf'<(?:button|a)[^>]+id="{control_id}"')

    def test_entry_title_is_a_visible_heading_without_an_eyebrow(self):
        html = self.read("static/index.html")
        self.assertRegex(html, r'<h1[^>]+id="entry-title"[^>]*>[^<]+</h1>')
        self.assertNotRegex(html, r'class="[^"]*\beyebrow\b[^"]*"')

    def test_entry_declares_privacy_and_script_order(self):
        html = self.read("static/index.html")
        self.assertIn('name="robots" content="noindex,nofollow,noarchive"', html)
        self.assertNotIn("navigator.geolocation", html)
        order = [
            html.index(name)
            for name in ("content.js", "experience-core.js", "experience.js")
        ]
        self.assertEqual(order, sorted(order))

    def test_body_begins_with_the_emitted_direction_contract(self):
        html = self.read("static/index.html")
        body = html.split("<body>", 1)[1].lstrip()
        self.assertTrue(body.startswith("<!--"), "the direction contract must be the body's first child")
        comment = re.match(r"<!--(.*?)-->", body, re.S)
        self.assertIsNotNone(comment)
        for marker in (
            "THESIS:", "OWN-WORLD:", "STORY:", "FIRST VIEWPORT:",
            "FORM:", "FINISH:", "starfield-coordinate",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, comment.group(1))

    def test_confirmed_visual_tokens_exist(self):
        css = self.read("static/theme.css")
        for color in ("#172333", "#111D2A", "#0C1622", "#F2EFE9", "#9FADB8", "#E8AD87"):
            self.assertIn(color.lower(), css.lower())

    def test_essential_status_and_instruction_copy_is_at_least_16px(self):
        css = self.read("static/experience.css")
        for selector in (".entry-actions small", "#password-feedback", ".noscript-note"):
            with self.subTest(selector=selector):
                block = re.search(rf"{re.escape(selector)}\s*\{{([^}}]+)\}}", css)
                self.assertIsNotNone(block)
                self.assertRegex(block.group(1), r"font-size:\s*16px\s*;")

    def test_focus_outline_uses_the_opaque_anchor_token(self):
        css = self.read("static/theme.css")
        self.assertRegex(css, re.compile(r"--focus:\s*#E8AD87\s*;", re.I))
        focus_rule = re.search(r":focus-visible\s*\{([^}]+)\}", css)
        self.assertIsNotNone(focus_rule)
        self.assertRegex(focus_rule.group(1), r"outline:\s*3px solid var\(--focus\)\s*;")

    def test_only_undecided_transition_content_stays_empty(self):
        content = self.read("static/content.js")
        self.assertNotIn("body: Object.freeze([])", content)
        self.assertIn("lines: Object.freeze([])", content)
        self.assertNotRegex(content, re.compile(r"lorem|待填写|以后再写", re.I))

    def test_experience_storage_and_network_boundaries(self):
        script = self.read("static/experience.js")
        self.assertIn('localStorage.setItem("letter_seen", "true")', script)
        self.assertNotIn("navigator.geolocation", script)
        self.assertNotRegex(script, re.compile(r"analytics|telemetry|beacon", re.I))
        self.assertIn('fetchWithTimeout("/api/login"', script)
        self.assertIn('fetchWithTimeout("/api/state"', script)

    def test_password_success_waits_for_visible_motion_before_map_navigation(self):
        script = self.read("static/experience.js")
        css = self.read("static/experience.css")
        self.assertIn("await runPasswordSuccessTransition(boxes)", script)
        self.assertNotRegex(
            script,
            re.compile(r"setTimeout\(\(\)\s*=>\s*window\.location\.assign\(\"/map\"\),\s*800\)"),
        )
        self.assertRegex(css, r'html\[data-auth="success"\]\s+#password-feedback')

    def test_map_has_all_material_states_and_external_assets(self):
        html = self.read("static/map.html")
        for state_id in ("map-waiting", "map-stopped", "map-stale", "map-error"):
            self.assertIn(f'id="{state_id}"', html)
        for asset in ("leaflet.css", "map.css", "leaflet.js", "experience-core.js", "map.js"):
            self.assertIn(asset, html)
        self.assertNotIn("<style>", html)
        self.assertNotRegex(html, re.compile(r"<script>(?!\s*</script>)", re.I))

    def test_map_title_has_no_eyebrow_or_kicker(self):
        html = self.read("static/map.html")
        self.assertRegex(html, r"<h1[^>]*>我的位置</h1>")
        self.assertNotRegex(html, re.compile(r'class="[^"]*\b(?:eyebrow|kicker)\b[^"]*"', re.I))

    def test_map_script_preserves_location_contract(self):
        script = self.read("static/map.js")
        for required in ("wgs2gcj", '"/api/state"', "setInterval(refresh, 10000)", "trailPoints"):
            self.assertIn(required, script)
        self.assertIn("tileerror", script)
        self.assertIn("locationFreshness", script)

    def test_map_logout_link_has_a_full_touch_target_without_extra_chrome(self):
        css = self.read("static/map.css")
        link_rule = re.search(r"\.location-summary a\s*\{([^}]+)\}", css)
        self.assertIsNotNone(link_rule)
        self.assertRegex(link_rule.group(1), r"min-height:\s*44px\s*;")
        self.assertNotRegex(link_rule.group(1), r"(?:background|border):")

    def test_inputs_and_dynamic_status_are_accessible(self):
        entry = self.read("static/index.html")
        map_html = self.read("static/map.html")
        self.assertIn('aria-live="polite"', entry)
        self.assertIn('role="group" aria-label="六位访问码"', entry)
        self.assertIn('aria-label="共享人的最后位置"', map_html)
        self.assertIn('<button id="retry-map"', map_html)

    def test_reduced_motion_and_small_screen_rules_exist(self):
        experience = self.read("static/experience.css")
        theme = self.read("static/theme.css")
        self.assertIn("prefers-reduced-motion", experience)
        self.assertIn("max-width: 359px", experience)
        self.assertIn("min-width: 320px", theme)

    def test_entry_anchor_has_a_one_shot_arrival_and_reduced_motion_fallback(self):
        css = self.read("static/experience.css")
        ring = re.search(r"\.entry-context::after\s*\{([^}]+)\}", css)
        point = re.search(r"\.anchor-point\s*\{([^}]+)\}", css)
        self.assertIsNotNone(ring)
        self.assertIsNotNone(point)
        self.assertRegex(ring.group(1), r"animation:\s*anchor-ring-arrival\b")
        self.assertRegex(point.group(1), r"animation:\s*anchor-point-arrival\b")
        self.assertNotIn("infinite", ring.group(1))
        self.assertNotIn("infinite", point.group(1))
        self.assertIn("@keyframes anchor-ring-arrival", css)
        self.assertIn("@keyframes anchor-point-arrival", css)

        reduced = css.split("@media (prefers-reduced-motion: reduce)", 1)[1]
        self.assertIn("anchor-reduced-fade", reduced)
        reduced_keyframes = re.search(
            r"@keyframes\s+anchor-reduced-fade\s*\{(.*?)\n\}", css, re.S
        )
        self.assertIsNotNone(reduced_keyframes)
        self.assertNotIn("transform", reduced_keyframes.group(1))

    def test_public_files_contain_no_secret_defaults(self):
        public = "\n".join(
            self.read(path)
            for path in (
                "static/index.html", "static/content.js", "static/experience-core.js",
                "static/experience.js", "static/map.html", "static/map.js",
            )
        )
        self.assertNotIn("owner123", public)
        self.assertNotIn('FRIEND_CODE', public)
        self.assertNotRegex(public, re.compile(r"navigator\.geolocation|sendBeacon|google-analytics", re.I))

    def test_html_fallback_copy_matches_the_confirmed_content(self):
        entry = self.read("static/index.html")
        confirmed = (
            "一个新的锚点",
            "读一封信",
            "有几句话，想安静地留在这里。",
            "查看位置",
            "直接看看我现在在哪里。",
            "你好，这是一封示例信。",
            "欢迎来到这个新的锚点。",
            "这里是一段示例正文。",
            "改完刷新页面即可生效",
            "示例段落：这里可以放第二段正文。",
            "示例段落：这里可以放第四段正文。",
            "示例段落：这里可以放第五段正文。",
            "示例段落：这里可以放最后一段",
            "正文。",
            "这里只会展示站主的位置，不会获取访客的定位，所以站主看不到你在哪里。",
            "访客打开这个页面时，站主不会收到任何通知。",
            "这个站点主要用于演示单向位置分享。",
            "访问码是 6 位数字，请向站主索取。",
            "查看位置需要启用 JavaScript。",
        )
        for copy in confirmed:
            with self.subTest(copy=copy):
                self.assertIn(copy, entry)

    def test_no_javascript_fallback_contains_the_complete_public_letter(self):
        entry = self.read("static/index.html")
        match = re.search(r"<noscript>(.*?)</noscript>", entry, re.S | re.I)
        self.assertIsNotNone(match)
        fallback = match.group(1)
        for paragraph in (
            "你好，这是一封示例信。",
            "欢迎来到这个新的锚点。",
            "这里是一段示例正文。",
            "改完刷新页面即可生效",
            "示例段落：这里可以放第二段正文。",
            "示例段落：这里可以放第四段正文。",
            "示例段落：这里可以放第五段正文。",
            "示例段落：这里可以放最后一段",
            "正文。",
            "这里只会展示站主的位置，不会获取访客的定位，所以站主看不到你在哪里。",
            "访客打开这个页面时，站主不会收到任何通知。",
            "这个站点主要用于演示单向位置分享。",
        ):
            with self.subTest(paragraph=paragraph):
                self.assertIn(paragraph, fallback)
        self.assertRegex(fallback, r"<article\b")
        self.assertIn("查看位置需要启用 JavaScript", fallback)
        self.assertNotRegex(fallback, re.compile(r"访问码第|地址|经度|纬度", re.I))
        self.assertNotRegex(fallback, re.compile(r"<(?:script|style)\b", re.I))

    def test_each_fallback_otp_input_has_its_exact_accessible_name(self):
        entry = self.read("static/index.html")
        labels = re.findall(r'<input[^>]+aria-label="([^"]+)"', entry)
        self.assertEqual(labels, [f"访问码第 {index} 位" for index in range(1, 7)])

    def test_visual_system_has_no_unapproved_palette_or_dependencies(self):
        html = "\n".join(self.read(path) for path in ("static/index.html", "static/map.html"))
        css = "\n".join(
            self.read(path)
            for path in ("static/theme.css", "static/experience.css", "static/map.css")
        )
        self.assertNotIn("#C7CED1", css.upper())
        self.assertNotRegex(html, re.compile(r'<(?:script|link)[^>]+(?:src|href)="https?://', re.I))
        self.assertNotRegex(css, re.compile(r"@import|url\([^)]*https?://", re.I))
        self.assertNotRegex(
            css,
            re.compile(r"backdrop-filter|background-clip\s*:\s*text|\b(?:glass|purple|neon|twinkle)\b", re.I),
        )


if __name__ == "__main__":
    unittest.main()
