#!/usr/bin/env python3
"""按固定规则上传视频（见 docs/media-upload-rule.md）。

1. 扫描 ~/Desktop/上传视频forxcy/；
2. 用拍摄时间和服务器已有记录比对，已上传的跳过；
3. 新视频压缩到网页友好大小后上传，并写入拍摄时间（有同名 txt 就一起写文字）；
4. 没有新视频就什么都不做。

用法:
  python3 tools/upload_videos.py --dry-run   # 只检查
  python3 tools/upload_videos.py             # 真正上传
"""
import argparse
import datetime
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

LOCAL_DIR = Path.home() / "Desktop" / "上传视频forxcy"
SERVER = "ubuntu@your-server-ip"
KEY = "/path/to/ssh-key"
REMOTE_DIR = "/opt/locapp/media"
VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm"}
AVCONVERT = "/usr/bin/avconvert"
EPOCH_1904_TO_1970 = 2082844800

SSH_OPTS = ["-i", KEY, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null"]


def ssh(command):
    return subprocess.run(["ssh", *SSH_OPTS, SERVER, command],
                          capture_output=True, text=True, check=True).stdout


def read_metadata(path):
    """返回 (拍摄时间 unix 秒, 时长秒)。读不到返回 (None, None)。"""
    def walk(handle, end):
        while handle.tell() < end:
            start = handle.tell()
            header = handle.read(8)
            if len(header) < 8:
                return None, None
            size, kind = struct.unpack(">I4s", header)
            if size == 1:
                size = struct.unpack(">Q", handle.read(8))[0]
            if size == 0:
                size = end - start
            if kind == b"moov":
                created, duration = walk(handle, start + size)
                if created:
                    return created, duration
            elif kind == b"mvhd":
                version = handle.read(1)[0]
                handle.read(3)
                if version == 1:
                    created_raw = struct.unpack(">Q", handle.read(8))[0]
                    handle.read(8)
                    timescale = struct.unpack(">I", handle.read(4))[0]
                    duration_raw = struct.unpack(">Q", handle.read(8))[0]
                else:
                    created_raw = struct.unpack(">I", handle.read(4))[0]
                    handle.read(4)
                    timescale = struct.unpack(">I", handle.read(4))[0]
                    duration_raw = struct.unpack(">I", handle.read(4))[0]
                seconds = created_raw - EPOCH_1904_TO_1970
                duration = duration_raw / timescale if timescale else None
                return (seconds if seconds > 0 else None), duration
            handle.seek(start + size)
        return None, None

    with open(path, "rb") as handle:
        return walk(handle, os.path.getsize(path))


def recorded_label(seconds):
    if not seconds:
        return ""
    return datetime.datetime.fromtimestamp(seconds).strftime("%Y-%m-%d %H:%M:%S")


def clean_name(path, taken):
    number, _ = split_stem(path.stem)
    if number:
        return f"{number}.mp4"
    stem = re.sub(r"[/\\]", "-", path.stem.strip()) or "video"
    return stem + ".mp4"


def split_stem(stem):
    """把文件名拆成 (编号, 文字)。
    IMG_0118.MOV            → ("0118", "")
    IMG_0118 太原的早晨.mov  → ("0118", "太原的早晨")
    2026.10.5 太原真冷.mov   → ("", "2026.10.5 太原真冷")
    """
    text = re.sub(r"^IMG[_-]?", "", stem.strip(), flags=re.I).strip()
    # 以日期开头（2026.10.5 …）时整段都当文字，不把年份当编号
    if re.match(r"^\d{4}[.\-/]\d{1,2}", text):
        return "", text
    match = re.match(r"^(\d{2,8})[\s._-]*(.*)$", text)
    if match:
        return match.group(1), match.group(2).strip(" 　._-")
    return "", text


def read_batch_captions(folder):
    """读取文件夹里的批量文案文件（文案.txt / captions.txt），一行一条：文件名 | 文字"""
    result = {}
    for candidate in sorted(folder.glob("文案*.txt")) + sorted(folder.glob("captions*.txt")):
        for line in candidate.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = re.split(r"\s*[|=｜＝]\s*", line, maxsplit=1)
            if len(parts) != 2:
                continue
            key = Path(parts[0].strip()).stem
            if key:
                result[key] = parts[1].strip()
                number, _ = split_stem(key)
                if number:
                    result.setdefault(number, parts[1].strip())
    return result


def resolve_caption(path, batch):
    """文字来源优先级：同名 txt → 批量文案文件 → 文件名里的文字 → 空（只显示时间）"""
    sidecar = path.with_suffix(".txt")
    if sidecar.exists():
        text = sidecar.read_text(encoding="utf-8").strip()
        if text:
            return text
    if path.stem in batch:
        return batch[path.stem]
    number, from_name = split_stem(path.stem)
    if number:
        for key in (number, f"IMG_{number}", f"IMG_{number}.MOV"):
            if key in batch:
                return batch[key]
    return from_name


def write_captions(captions):
    """把 captions.json 写回服务器，并在本地留一份备份。"""
    with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False) as handle:
        json.dump(captions, handle, ensure_ascii=False, indent=2)
        local_json = handle.name
    subprocess.run(["scp", *SSH_OPTS, local_json, f"{SERVER}:/home/ubuntu/captions.json"],
                   check=True, capture_output=True)
    ssh(f"sudo mv /home/ubuntu/captions.json {REMOTE_DIR}/captions.json && "
        f"sudo chown ubuntu:ubuntu {REMOTE_DIR}/captions.json")
    backup = Path("media-captions.backup.json")
    backup.write_text(json.dumps(captions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    Path(local_json).unlink(missing_ok=True)


def remote_state():
    listing = ssh(f"ls -1 {REMOTE_DIR}")
    names = [line.strip() for line in listing.splitlines() if line.strip()]
    captions = {}
    try:
        raw = ssh(f"cat {REMOTE_DIR}/captions.json")
        captions = json.loads(raw) if raw.strip() else {}
    except subprocess.CalledProcessError:
        captions = {}
    return names, captions


def transcode(source, target_dir):
    """压缩到网页友好大小：先 540p，码率仍偏高再降到 480p。"""
    duration = read_metadata(source)[1] or 0
    output = Path(target_dir) / (Path(source).stem + "-web.mp4")
    for preset, budget in (("Preset960x540", 3_200_000), ("Preset640x480", 3_200_000)):
        subprocess.run([AVCONVERT, "--preset", preset, "--source", str(source),
                        "--output", str(output), "--replace"],
                       capture_output=True, check=True)
        if not duration:
            break
        bitrate = output.stat().st_size * 8 / duration
        if bitrate <= budget:
            break
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="只检查，不上传")
    args = parser.parse_args()

    if not LOCAL_DIR.is_dir():
        print(f"找不到文件夹：{LOCAL_DIR}")
        return 1

    local_videos = sorted(p for p in LOCAL_DIR.iterdir()
                          if p.is_file() and p.suffix.lower() in VIDEO_SUFFIXES
                          and not p.name.startswith("."))
    if not local_videos:
        print(f"{LOCAL_DIR} 里还没有视频。")
        return 0

    names, captions = remote_state()
    batch_captions = read_batch_captions(LOCAL_DIR)
    if batch_captions:
        print(f"读到批量文案 {len(batch_captions)} 条（来自文案文件）")
    uploaded_times = {meta.get("recorded") for meta in captions.values() if meta.get("recorded")}
    by_recorded = {meta.get("recorded"): name for name, meta in captions.items() if meta.get("recorded")}
    uploaded_digits = {re.sub(r"\D", "", name) for name in names}

    pending = []
    caption_updates = {}
    for path in local_videos:
        taken, duration = read_metadata(path)
        label = recorded_label(taken)
        if label and label in uploaded_times:
            # 已经传过的视频：如果现在给了文字，就只更新文字，不重复上传
            server_name = by_recorded.get(label)
            text = resolve_caption(path, batch_captions)
            current = (captions.get(server_name) or {}).get("caption") or ""
            changed = bool(text) and text != current
            if changed:
                caption_updates[server_name] = {"caption": text, "recorded": label}
            print(f"跳过（已上传过）：{path.name} · 拍摄 {label}"
                  + ("　→ 发现新文字，稍后更新说明" if changed else ""))
            continue
        digits = re.sub(r"\D", "", path.stem)
        if digits and digits in uploaded_digits:
            print(f"跳过（服务器已有同名数字编号）：{path.name}")
            continue
        pending.append((path, taken, duration, label))

    if not pending:
        if caption_updates and not args.dry_run:
            captions.update(caption_updates)
            write_captions(captions)
            print(f"\n已更新 {len(caption_updates)} 条视频的文字说明（没有重复上传视频）。")
        elif caption_updates:
            print(f"\n（--dry-run：会更新 {len(caption_updates)} 条文字说明）")
        else:
            print("没有需要上传的新视频。")
        return 0

    print(f"发现 {len(pending)} 条新视频：")
    for path, _, duration, label in pending:
        size_mb = path.stat().st_size / 1024 / 1024
        print(f"  · {path.name}（{size_mb:.1f} MB，{duration:.1f} 秒，拍摄 {label or '未知'}）")

    if args.dry_run:
        print("\n（--dry-run：没有实际上传）")
        return 0

    with tempfile.TemporaryDirectory() as tmp:
        new_entries = {}
        for path, taken, _, label in pending:
            name = clean_name(path, taken)
            while name in names:
                name = name.replace(".mp4", "-2.mp4")
            print(f"\n→ 压缩 {path.name} → {name}")
            web = transcode(path, tmp)
            print(f"  压缩后 {web.stat().st_size / 1024 / 1024:.1f} MB")
            subprocess.run(["scp", *SSH_OPTS, str(web), f"{SERVER}:/home/ubuntu/upload-video.tmp"],
                           check=True, capture_output=True)
            ssh(f"sudo mv /home/ubuntu/upload-video.tmp '{REMOTE_DIR}/{name}' && "
                f"sudo chown ubuntu:ubuntu '{REMOTE_DIR}/{name}'")

            caption = resolve_caption(path, batch_captions)
            new_entries[name] = {"caption": caption, "recorded": label}
            names.append(name)
            print(f"  已上传{'（含文字说明）' if caption else '（只有时间）'}")

        captions.update(new_entries)
        captions.update(caption_updates)
        write_captions(captions)

    print("\n完成。新增：")
    for name, meta in new_entries.items():
        print(f"  · {name} —— {meta['recorded'] or '时间未知'}"
              + (f"｜{meta['caption']}" if meta["caption"] else "｜（未写文字）"))
    print("\n服务器上现在共有：" + "、".join(sorted(names)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
