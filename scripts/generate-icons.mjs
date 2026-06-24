// scripts/generate-icons.mjs
// Regenerate every app-icon asset from a single source: build/icon.svg.
//   build/icon.png   (1024) — electron-builder fallback + Linux
//   build/icon.icns  (macOS, via iconutil)
//   build/icon.ico   (Windows, via png-to-ico)
//   resources/icon.png (1024) — in-app window icon (?asset import)
// Run with: npm run icons   (macOS only — uses iconutil for .icns)

import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = join(root, 'build', 'icon.svg')

const renderCache = new Map()
/** Rasterize the source SVG to a square PNG buffer of the given pixel size. */
function render(size) {
  if (renderCache.has(size)) return renderCache.get(size)
  const resvg = new Resvg(readFileSync(svg), {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  })
  const png = resvg.render().asPng()
  renderCache.set(size, png)
  return png
}

// --- master PNGs ---
writeFileSync(join(root, 'build', 'icon.png'), render(1024))
writeFileSync(join(root, 'resources', 'icon.png'), render(1024))
console.log('✓ build/icon.png + resources/icon.png (1024)')

// --- macOS .icns via iconutil ---
const iconset = mkdtempSync(join(tmpdir(), 'ck-icon-')) + '/icon.iconset'
mkdirSync(iconset, { recursive: true })
const map = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
]
for (const [size, name] of map) writeFileSync(join(iconset, name), render(size))
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build', 'icon.icns')])
rmSync(dirname(iconset), { recursive: true, force: true })
console.log('✓ build/icon.icns')

// --- Windows .ico via png-to-ico ---
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const ico = await pngToIco(icoSizes.map((s) => render(s)))
writeFileSync(join(root, 'build', 'icon.ico'), ico)
console.log('✓ build/icon.ico')

console.log('Done.')
