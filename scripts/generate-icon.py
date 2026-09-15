from pathlib import Path
from PIL import Image, ImageDraw

out = Path('build/icon.ico')
out.parent.mkdir(parents=True, exist_ok=True)
images = []
for size in (16, 24, 32, 48, 64, 96, 128, 256):
    image = Image.new('RGBA', (size, size), '#111827')
    draw = ImageDraw.Draw(image)
    margin = max(1, size // 8)
    draw.rounded_rectangle((margin, margin, size-margin-1, size-margin-1), radius=max(2, size//8), fill='#2563eb')
    # Two opposing transfer arrows.
    w = max(1, size // 10)
    y1, y2 = size * .40, size * .60
    draw.line((size*.25, y1, size*.75, y1), fill='white', width=w)
    draw.polygon(((size*.75, y1), (size*.58, y1-size*.12), (size*.58, y1+size*.12)), fill='white')
    draw.line((size*.75, y2, size*.25, y2), fill='#bfdbfe', width=w)
    draw.polygon(((size*.25, y2), (size*.42, y2-size*.12), (size*.42, y2+size*.12)), fill='#bfdbfe')
    images.append(image)
images[-1].save(out, format='ICO')
print(out, out.stat().st_size)
