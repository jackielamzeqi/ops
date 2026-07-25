/**
 * 生成 PWA 图标（192 / 512 PNG + SVG）
 * 依赖本机 Python3 + Pillow：python3 -c "from PIL import Image"
 */
import { spawnSync } from 'child_process'
import { writeFileSync } from 'fs'

const py = `
from PIL import Image, ImageDraw
import os

out_dir = "public/icons"
os.makedirs(out_dir, exist_ok=True)

def make_icon(size, path):
    bg = (26, 26, 46, 255)
    accent = (10, 132, 255, 255)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * 0.22)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=bg)
    cx, cy = size * 0.5, size * 0.48
    s = size * 0.42
    bolt = [
        (cx + s * 0.05, cy - s * 0.55),
        (cx - s * 0.28, cy + s * 0.05),
        (cx - s * 0.02, cy + s * 0.05),
        (cx - s * 0.18, cy + s * 0.55),
        (cx + s * 0.32, cy - s * 0.08),
        (cx + s * 0.05, cy - s * 0.08),
    ]
    d.polygon(bolt, fill=accent)
    d.ellipse(
        (size * 0.68, size * 0.14, size * 0.86, size * 0.32),
        fill=(99, 102, 241, 180),
    )
    img.save(path, "PNG")
    print(f"wrote {path} ({os.path.getsize(path)} bytes)")

make_icon(192, f"{out_dir}/icon-192.png")
make_icon(512, f"{out_dir}/icon-512.png")
`

const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' })
if (r.status !== 0) {
  console.error(r.stderr || r.stdout)
  process.exit(r.status || 1)
}
console.log(r.stdout)

for (const size of [192, 512]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#1a1a2e"/>
  <path d="M${size * 0.52} ${size * 0.22} L${size * 0.36} ${size * 0.52} L${size * 0.48} ${size * 0.52} L${size * 0.40} ${size * 0.78} L${size * 0.66} ${size * 0.46} L${size * 0.52} ${size * 0.46} Z" fill="#0A84FF"/>
  <circle cx="${size * 0.77}" cy="${size * 0.23}" r="${size * 0.07}" fill="#6366F1" opacity="0.7"/>
</svg>
`
  writeFileSync(`public/icons/icon-${size}.svg`, svg)
  console.log(`wrote public/icons/icon-${size}.svg`)
}

console.log('✅ 图标已生成（真实 PNG，非 1x1 占位）')
