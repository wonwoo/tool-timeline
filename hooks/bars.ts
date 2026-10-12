import type { ImageSource } from 'claude-code'

// Bars as pictures, where the terminal draws them: a capsule in the line's middle, half of it tall, as the
// desktop draws its lanes; no block glyph can, each standing on its cell's floor. Over the gaps a hairline track
const CELL_WIDTH = 16
const CELL_HEIGHT = 32
const BAR_HEIGHT = 16
const TRACK_HEIGHT = 2
// A turn redraws its lines more often than they change; the same bar is not painted twice
const MAX_KEPT = 200

// A stretch of the bar's width, from 0 to 1, in the bar's color unless it has one of its own
export type Stretch = { from: number; to: number; color?: string }
export type Track = { color: string; alpha: number }

const kept = new Map<string, ImageSource>()

export function barPicture(columns: number, stretches: Stretch[], color: string, track: Track): ImageSource {
  const key = JSON.stringify([columns, stretches, color, track])
  const known = kept.get(key)
  if (known !== undefined) {
    return known
  }
  const width = columns * CELL_WIDTH
  const height = CELL_HEIGHT
  const middle = height / 2
  const radius = BAR_HEIGHT / 2
  // Each stretch as the line its capsule is drawn around; a short one still a whole dot, kept inside the picture
  const cores = stretches.map(({ from, to, color: own }) => {
    const end = Math.min(width, Math.max(to * width, from * width + BAR_HEIGHT))
    const start = Math.max(0, Math.min(from * width, end - BAR_HEIGHT))
    return [start + radius, end - radius, rgb(own ?? color)] as const
  })
  const line = rgb(track.color)
  const fallback = rgb(color)
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const py = y + 0.5
    const lineAlpha = Math.abs(py - middle) <= TRACK_HEIGHT / 2 ? track.alpha : 0
    for (let x = 0; x < width; x++) {
      const px = x + 0.5
      // How much of the pixel a capsule covers, a pixel's width of soft edge, in the color of the one covering most
      let cover = 0
      let bar = cores[0]?.[2] ?? fallback
      for (const [a, z, own] of cores) {
        const distance = Math.hypot(px - Math.min(Math.max(px, a), z), py - middle) - radius
        const covers = Math.min(1, Math.max(0, 0.5 - distance))
        if (covers > cover) {
          cover = covers
          bar = own
        }
      }
      const alpha = cover + lineAlpha * (1 - cover)
      if (alpha === 0) {
        continue
      }
      const i = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        pixels[i + c] = Math.round((bar[c]! * cover + line[c]! * lineAlpha * (1 - cover)) / alpha)
      }
      pixels[i + 3] = Math.round(alpha * 255)
    }
  }
  const source: ImageSource = { rgba: base64(pixels), width, height }
  kept.set(key, source)
  if (kept.size > MAX_KEPT) {
    kept.delete(kept.keys().next().value!)
  }

  return source
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function base64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(text)
}
