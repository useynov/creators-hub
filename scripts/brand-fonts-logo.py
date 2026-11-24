"""Prepares the brand font and the logo for the app. The results are NOT in git (see README, "Brand assets").

    pip install fonttools brotli potracer pillow numpy
    python3 scripts/brand-fonts-logo.py <folder with TCCC-Unity*.ttf> <coca-cola logo .png with a transparent background> content/brand

Fonts: TCCC Unity is the property of The Coca-Cola Company. Five cuts are converted to WOFF2.
Logo: the script wordmark is traced from the PNG into one SVG path, saved in brand red and in white.
"""
import sys
from pathlib import Path

import numpy as np
import potrace
from fontTools.ttLib import TTFont
from PIL import Image

fonts_dir, logo_png, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)

FONTS = {
    "TCCC-UnityHeadline-Black.ttf": "unity-headline-black.woff2",
    "TCCC-UnityHeadline-Bold.ttf": "unity-headline-bold.woff2",
    "TCCC-UnityText-Regular.ttf": "unity-text-regular.woff2",
    "TCCC-UnityText-Medium.ttf": "unity-text-medium.woff2",
    "TCCC-UnityText-Bold.ttf": "unity-text-bold.woff2",
}
for source, target in FONTS.items():
    font = TTFont(fonts_dir / source)
    font.flavor = "woff2"
    font.save(out / target)
    print(target, (out / target).stat().st_size // 1024, "KB")

image = Image.open(logo_png).convert("RGBA")
alpha = image.getchannel("A")
left, top, right, bottom = alpha.getbbox()
mask = np.array(alpha.crop((left, top, right, bottom))) > 127
width, height = mask.shape[1], mask.shape[0]
trace = potrace.Bitmap(~mask).trace(turdsize=4, alphamax=1.0, opticurve=True, opttolerance=0.2)
parts = []
for curve in trace:
    start = curve.start_point
    parts.append(f"M{start.x:.1f} {start.y:.1f}")
    for segment in curve.segments:
        if segment.is_corner:
            parts.append(f"L{segment.c.x:.1f} {segment.c.y:.1f}L{segment.end_point.x:.1f} {segment.end_point.y:.1f}")
        else:
            parts.append(f"C{segment.c1.x:.1f} {segment.c1.y:.1f} {segment.c2.x:.1f} {segment.c2.y:.1f} {segment.end_point.x:.1f} {segment.end_point.y:.1f}")
    parts.append("Z")
path = "".join(parts)
for name, colour in (("logo-red", "#F40009"), ("logo-white", "#FFFFFF")):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="Coca-Cola"><path fill="{colour}" fill-rule="evenodd" d="{path}"/></svg>\n'
    (out / f"{name}.svg").write_text(svg)
    print(f"{name}.svg", len(svg) // 1024, "KB", f"{width}x{height}")
