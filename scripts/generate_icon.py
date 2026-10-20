from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
(root / 'assets').mkdir(exist_ok=True)
image = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((16, 16, 496, 496), radius=115, fill='#2b354b')
draw.rounded_rectangle((106, 191, 406, 383), radius=24, fill='#e9f0ff')
draw.rounded_rectangle((106, 142, 406, 217), radius=15, fill='#86a8fa')
for x in (127, 217, 307):
    draw.polygon([(x, 142), (x+35, 142), (x-6, 217), (x-41, 217)], fill='#e9f0ff')
draw.polygon([(222, 250), (222, 339), (301, 295)], fill='#4d76dc')
image.save(root / 'assets' / 'icon.png')
image.save(root / 'assets' / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
