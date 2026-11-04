# PNGアイコンを描く（icons/icon.svg と同じデザイン）
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'icons'
S = 1024  # 2倍で描いて縮小


def radial(size, center, radius, stops):
    img = Image.new('RGBA', (size, size))
    px = img.load()
    cx, cy = center
    for y in range(size):
        for x in range(size):
            t = min(1, math.hypot(x - cx, y - cy) / radius)
            for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
                if t <= t1:
                    k = (t - t0) / (t1 - t0) if t1 > t0 else 0
                    px[x, y] = tuple(int(a + (b - a) * k) for a, b in zip(c0, c1))
                    break
    return img


def star(d, cx, cy, outer, inner, fill):
    pts = []
    for i in range(8):
        r = outer if i % 2 == 0 else inner
        a = -math.pi / 2 + i * math.pi / 4
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon(pts, fill=fill)


def draw(maskable=False):
    k = S / 512
    img = radial(S, (S * 0.5, S * 0.3), S * 0.75,
                 [(0, (38, 48, 106, 255)), (0.55, (18, 26, 61, 255)), (1, (7, 11, 31, 255))])
    scale = 0.78 if maskable else 1.0
    off = (1 - scale) * 256

    def P(v):
        return (off + v * scale) * k

    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([P(256 - 95), P(230 - 95), P(256 + 95), P(230 + 95)], fill=(170, 195, 255, 150))
    glow = glow.filter(ImageFilter.GaussianBlur(40 * k))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)
    d.ellipse([P(106), P(80), P(406), P(380)], outline=(255, 217, 138, 100), width=int(6 * k * scale))
    star(d, P(256), P(230), 120 * k * scale, 22 * k * scale, (255, 255, 255, 255))
    star(d, P(256), P(230), 50 * k * scale, 9 * k * scale, (255, 217, 138, 255))
    dots = [(150, 400, 7), (220, 430, 5), (300, 415, 6), (370, 385, 7)]
    d.line([(P(x), P(y)) for x, y, _ in dots], fill=(255, 217, 138, 130), width=int(3 * k * scale))
    for x, y, r in dots:
        d.ellipse([P(x) - r * k * scale, P(y) - r * k * scale, P(x) + r * k * scale, P(y) + r * k * scale], fill=(255, 217, 138, 255))
    if not maskable:
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(112 * k), fill=255)
        img.putalpha(mask)
    return img


base = draw()
base.resize((512, 512), Image.LANCZOS).save(OUT / 'icon-512.png')
base.resize((192, 192), Image.LANCZOS).save(OUT / 'icon-192.png')
draw(maskable=True).resize((512, 512), Image.LANCZOS).save(OUT / 'icon-maskable-512.png')
print('icons ok')
