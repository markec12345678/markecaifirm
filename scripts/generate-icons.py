"""Generate PWA icons for Markec AI Firm."""
from PIL import Image, ImageDraw, ImageFont
import os

OUTPUT_DIR = '/home/z/my-project/public'

BG_COLOR = (10, 14, 10, 255)
PRIMARY = (74, 222, 128, 255)
AMBER = (251, 191, 36, 255)
BORDER = (31, 42, 31, 255)

def make_icon(size: int, output_path: str):
    img = Image.new('RGBA', (size, size), BG_COLOR)
    draw = ImageDraw.Draw(img)
    margin = max(2, size // 32)
    draw.rectangle(
        [margin, margin, size - margin, size - margin],
        outline=BORDER, width=max(2, size // 64)
    )
    try:
        font_size = int(size * 0.6)
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', font_size)
    except Exception:
        font = ImageFont.load_default()
    text = 'M'
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (size - text_w) // 2 - bbox[0]
    y = (size - text_h) // 2 - bbox[1] - int(size * 0.02)
    draw.text((x, y), text, fill=PRIMARY, font=font)
    dot_size = max(4, size // 16)
    dot_x = size - margin - dot_size - dot_size // 2
    dot_y = margin + dot_size // 2
    draw.ellipse([dot_x, dot_y, dot_x + dot_size, dot_y + dot_size], fill=AMBER)
    img.save(output_path, 'PNG')
    print(f'Created {output_path} ({size}x{size})')

os.makedirs(OUTPUT_DIR, exist_ok=True)
make_icon(192, os.path.join(OUTPUT_DIR, 'icon-192.png'))
make_icon(512, os.path.join(OUTPUT_DIR, 'icon-512.png'))
make_icon(32, os.path.join(OUTPUT_DIR, 'favicon-32.png'))
make_icon(16, os.path.join(OUTPUT_DIR, 'favicon-16.png'))
img32 = Image.open(os.path.join(OUTPUT_DIR, 'favicon-32.png'))
img32.save(os.path.join(OUTPUT_DIR, 'favicon.ico'), format='ICO', sizes=[(32, 32)])
print('Created favicon.ico')
