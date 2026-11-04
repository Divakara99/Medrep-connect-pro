#!/usr/bin/env python3
"""Build the "How to use MedRep Pro" walkthrough video from this project's own
artwork — no stock footage, no external links, no synthetic voice.

Inputs (all already in the repo):
    store-listing/screenshot-1-home.png     Home / job list
    store-listing/screenshot-2-unlock.png   Rewarded-video company unlock
    store-listing/screenshot-3-details.png  Job detail
    store-listing/screenshot-4-plans.png    Plans / passes
    store-listing/icon-512.png              App icon (intro card)

Output:
    public/tutorial/walkthrough.mp4   1080x1920, 24 fps, H.264, faststart

The video is deliberately SILENT: the tour's narration must be the founder's own
voice. When a recorded voice-over exists per language, mux it with:

    ffmpeg -i public/tutorial/walkthrough.mp4 -i public/tutorial/<code>.mp3 \\
           -c:v copy -c:a aac -b:a 128k -shortest public/tutorial/<code>.mp4

Requires: imageio-ffmpeg, Pillow  (dev-only; not a runtime dependency)
    python3 -m venv .videnv && .videnv/bin/pip install imageio-ffmpeg pillow
    .videnv/bin/python scripts/build-tutorial-video.py
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "store-listing"
OUT = ROOT / "public" / "tutorial"
WORK = pathlib.Path("/tmp/medrep-tutorial-scenes")

W, H = 1080, 1920
FPS = 24
FADE = 0.6  # crossfade seconds

BRAND_DARK = (10, 32, 78)
BRAND = (29, 78, 216)
BRAND_LIGHT = (59, 130, 246)


def font(size: int) -> ImageFont.FreeTypeFont:
    """Pillow ships a scalable default face, so the build needs no system fonts."""
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def gradient(top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGB", (W, H), top)
    draw = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        draw.line(
            [(0, y), (W, y)],
            fill=(
                int(top[0] + (bottom[0] - top[0]) * t),
                int(top[1] + (bottom[1] - top[1]) * t),
                int(top[2] + (bottom[2] - top[2]) * t),
            ),
        )
    return img


def centered(draw: ImageDraw.ImageDraw, y: int, text: str, size: int, fill, spacing: int = 0):
    f = font(size)
    width = draw.textlength(text, font=f)
    draw.text(((W - width) / 2, y), text, font=f, fill=fill)
    return y + size + spacing


def intro_card() -> Image.Image:
    img = gradient(BRAND_DARK, BRAND)
    draw = ImageDraw.Draw(img)

    icon = Image.open(ASSETS / "icon-512.png").convert("RGBA").resize((360, 360), Image.LANCZOS)
    img.paste(icon, ((W - 360) // 2, 430), icon)

    y = centered(draw, 860, "MedRep Pro", 96, (255, 255, 255), 24)
    y = centered(draw, y, "How to use the app", 56, (219, 234, 254), 60)
    centered(draw, y, "Created by M. Divakar Reddy", 38, (191, 219, 254))
    centered(draw, H - 150, "Pharma & MR jobs across India", 34, (191, 219, 254))
    return img


def outro_card() -> Image.Image:
    img = gradient(BRAND, BRAND_DARK)
    draw = ImageDraw.Draw(img)
    y = centered(draw, 700, "Apply in one tap", 84, (255, 255, 255), 40)
    y = centered(draw, y, "Unlock company names free", 52, (219, 234, 254), 28)
    y = centered(draw, y, "Passes from Rs 19 for 1 day", 46, (191, 219, 254), 90)
    centered(draw, y, "medrepconnect.in", 48, (255, 255, 255))
    centered(draw, H - 140, "Made in India for pharma field teams", 32, (191, 219, 254))
    return img


def screen_card(screenshot: str, step: int, caption: str) -> Image.Image:
    """A real app screen on top, with its own caption panel underneath.

    The artwork is cropped above its own footer text and the caption lives in a
    solid panel, so nothing overlaps and every step reads cleanly on a phone.
    """
    panel_h = 384
    base = Image.open(ASSETS / screenshot).convert("RGB").resize((W, H), Image.LANCZOS)
    shot = base.crop((0, 0, W, H - panel_h)).resize((W, H - panel_h), Image.LANCZOS)

    img = Image.new("RGB", (W, H), BRAND_DARK)
    img.paste(shot, (0, 0))
    draw = ImageDraw.Draw(img)

    # Caption panel with a soft top edge so it reads as a designed card.
    panel_top = H - panel_h
    for y in range(panel_top, H):
        t = (y - panel_top) / panel_h
        draw.line(
            [(0, y), (W, y)],
            fill=(
                int(BRAND_DARK[0] + (BRAND[0] - BRAND_DARK[0]) * t),
                int(BRAND_DARK[1] + (BRAND[1] - BRAND_DARK[1]) * t),
                int(BRAND_DARK[2] + (BRAND[2] - BRAND_DARK[2]) * t),
            ),
        )

    pill = f"STEP {step} OF 4"
    f_pill = font(30)
    pw = draw.textlength(pill, font=f_pill)
    draw.rounded_rectangle(
        [(72, panel_top + 44), (72 + pw + 48, panel_top + 96)], radius=26, fill=BRAND_LIGHT
    )
    draw.text((96, panel_top + 53), pill, font=f_pill, fill=(255, 255, 255))

    f_cap, size = font(56), 56
    words, line, lines = caption.split(), "", []
    for word in words:
        candidate = f"{line} {word}".strip()
        if draw.textlength(candidate, font=f_cap) > W - 144:
            lines.append(line)
            line = word
        else:
            line = candidate
    lines.append(line)

    y = panel_top + 126
    for text in lines[:2]:
        draw.text((72, y), text, font=f_cap, fill=(255, 255, 255))
        y += size + 8

    for i in range(4):
        cx = 76 + i * 42
        color = (255, 255, 255) if i < step else (96, 122, 178)
        draw.ellipse([(cx, H - 52), (cx + 18, H - 34)], fill=color)
    return img


SCENES = [
    (intro_card, 5.0),
    (lambda: screen_card("screenshot-1-home.png", 1, "Find live MR & pharma jobs"), 9.0),
    (lambda: screen_card("screenshot-2-unlock.png", 2, "Unlock company names free"), 9.0),
    (lambda: screen_card("screenshot-3-details.png", 3, "See every job detail"), 9.0),
    (lambda: screen_card("screenshot-4-plans.png", 4, "Choose a pass for manager contacts"), 9.0),
    (outro_card, 6.0),
]


def build() -> pathlib.Path:
    WORK.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    paths, durations = [], []
    for i, (factory, seconds) in enumerate(SCENES):
        path = WORK / f"scene-{i:02d}.png"
        factory().save(path)
        paths.append(path)
        durations.append(seconds)

    frames = [round(d * FPS) for d in durations]
    inputs = []
    for path, count in zip(paths, frames):
        inputs += ["-loop", "1", "-t", f"{count / FPS:.3f}", "-i", str(path)]

    # Slow push-in on every still (Ken Burns), then a crossfade chain.
    filters = []
    for i, count in enumerate(frames):
        # d=1 keeps one output frame per input frame (d=count multiplies the
        # clip length by `count`); the push-in accumulates frame by frame.
        filters.append(
            f"[{i}:v]scale=1620:-1,zoompan=z='min(zoom+0.0006,1.15)':d=1"
            f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS},setsar=1[v{i}]"
        )
    current = "v0"
    elapsed = durations[0]
    for i in range(1, len(paths)):
        offset = elapsed - FADE
        filters.append(
            f"[{current}][v{i}]xfade=transition=fade:duration={FADE}:offset={offset:.3f}[x{i}]"
        )
        current = f"x{i}"
        elapsed += durations[i] - FADE

    cmd = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-y",
        *inputs,
        "-filter_complex", ";".join(filters),
        "-map", f"[{current}]",
        "-c:v", "libx264", "-profile:v", "high", "-level", "4.0",
        "-pix_fmt", "yuv420p", "-crf", "25", "-preset", "medium",
        "-r", str(FPS), "-movflags", "+faststart", "-an",
        str(OUT / "walkthrough.mp4"),
    ]
    print("rendering", len(paths), "scenes →", OUT / "walkthrough.mp4")
    subprocess.run(cmd, check=True)
    return OUT / "walkthrough.mp4"


if __name__ == "__main__":
    target = build()
    size_mb = target.stat().st_size / (1024 * 1024)
    print(f"done: {target} ({size_mb:.1f} MB)")
    sys.exit(0)
