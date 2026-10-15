import importlib.util
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "tools" / "upload_videos.py"
spec = importlib.util.spec_from_file_location("upload_videos", TOOL)
upload_videos = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload_videos)


class UploadToolCaptionTest(unittest.TestCase):
    def test_stem_splits_number_and_written_text(self):
        self.assertEqual(upload_videos.split_stem("IMG_0118"), ("0118", ""))
        self.assertEqual(upload_videos.split_stem("IMG_0118 太原的早晨"), ("0118", "太原的早晨"))
        self.assertEqual(upload_videos.split_stem("0119-杭州的雨"), ("0119", "杭州的雨"))
        self.assertEqual(upload_videos.split_stem("2026.10.5 太原真冷"), ("", "2026.10.5 太原真冷"))

    def test_server_name_prefers_the_number(self):
        self.assertEqual(upload_videos.clean_name(Path("IMG_0118 太原的早晨.MOV"), None), "0118.mp4")
        self.assertEqual(upload_videos.clean_name(Path("海边.mov"), None), "海边.mp4")

    def test_batch_file_lines_are_parsed(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "文案.txt").write_text(
                "# 注释会被忽略\nIMG_0118 | 太原的早晨真冷\nIMG_0119＝只留时间\n坏行没有分隔符\n",
                encoding="utf-8",
            )
            parsed = upload_videos.read_batch_captions(folder)
            self.assertEqual(parsed["IMG_0118"], "太原的早晨真冷")
            self.assertEqual(parsed["IMG_0119"], "只留时间")
            self.assertEqual(parsed["0118"], "太原的早晨真冷")   # 也能用编号查到

    def test_caption_priority(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            video = folder / "IMG_0118 文件名里的话.mov"
            video.write_bytes(b"x")
            batch = {"IMG_0118": "批量文案"}
            # 1) 没有 sidecar / 批量文案时，用文件名里的文字
            self.assertEqual(upload_videos.resolve_caption(video, {}), "文件名里的话")
            # 2) 批量文案优先于文件名
            self.assertEqual(upload_videos.resolve_caption(video, batch), "批量文案")
            # 3) 同名 txt 优先级最高
            video.with_suffix(".txt").write_text("单独写的文案", encoding="utf-8")
            self.assertEqual(upload_videos.resolve_caption(video, batch), "单独写的文案")
            # 4) 纯编号文件名没有文字 → 只显示时间
            plain = folder / "IMG_0119.mov"
            plain.write_bytes(b"x")
            self.assertEqual(upload_videos.resolve_caption(plain, {}), "")


if __name__ == "__main__":
    unittest.main()
