import { useEffect, useRef, useState } from 'react'
import { hexToRgb, hsbToRgb, rgbToHex, rgbToHsb } from '@animationboard/drawing-engine'
import './ColorWheel.css'

const SIZE = 220
const CENTER = SIZE / 2
const OUTER_RADIUS = 105
const RING_THICKNESS = 22
const INNER_RADIUS = OUTER_RADIUS - RING_THICKNESS
const DIAMOND_R = INNER_RADIUS - 8
// The diamond is a classic saturation/value square rotated 45 degrees — SQUARE_HALF
// is that square's half-extent once diamond-local coords are un-rotated (see posToSV).
const SQUARE_HALF = DIAMOND_R / Math.SQRT2
const HANDLE_RADIUS = 7

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/** Diamond-local offset from center -> {s,v} in [0,100]. Un-rotates by -45deg into an
 *  axis-aligned SV square (top=white, right=hue, bottom=black, left=black), per the
 *  derivation in the item-6 plan. */
function posToSV(dx: number, dy: number): { s: number; v: number } {
  const u = (dx + dy) / Math.SQRT2
  const w = (dy - dx) / Math.SQRT2
  const s = clamp01((u + SQUARE_HALF) / (2 * SQUARE_HALF))
  const v = clamp01((SQUARE_HALF - w) / (2 * SQUARE_HALF))
  return { s: s * 100, v: v * 100 }
}

/** Inverse of posToSV — where the diamond handle sits for a given {s,v}, e.g. when a
 *  slider (not a drag) changes the color. */
function svToPos(s: number, v: number): { dx: number; dy: number } {
  const u = (s / 100) * 2 * SQUARE_HALF - SQUARE_HALF
  const w = SQUARE_HALF - (v / 100) * 2 * SQUARE_HALF
  return { dx: (u - w) / Math.SQRT2, dy: (u + w) / Math.SQRT2 }
}

function buildRingImageData(): ImageData {
  const data = new ImageData(SIZE, SIZE)
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const dx = px - CENTER
      const dy = py - CENTER
      const dist = Math.hypot(dx, dy)
      if (dist < INNER_RADIUS || dist > OUTER_RADIUS) continue
      let hue = (Math.atan2(dy, dx) * 180) / Math.PI
      if (hue < 0) hue += 360
      const { r, g, b } = hsbToRgb(hue, 100, 100)
      const i = (py * SIZE + px) * 4
      data.data[i] = r
      data.data[i + 1] = g
      data.data[i + 2] = b
      data.data[i + 3] = 255
    }
  }
  return data
}

function buildDiamondImageData(hue: number): ImageData {
  const data = new ImageData(SIZE, SIZE)
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const dx = px - CENTER
      const dy = py - CENTER
      if (Math.abs(dx) + Math.abs(dy) > DIAMOND_R) continue
      const { s, v } = posToSV(dx, dy)
      const { r, g, b } = hsbToRgb(hue, s, v)
      const i = (py * SIZE + px) * 4
      data.data[i] = r
      data.data[i + 1] = g
      data.data[i + 2] = b
      data.data[i + 3] = 255
    }
  }
  return data
}

// putImageData replaces pixels wholesale (no alpha compositing), so the ring and
// diamond bitmaps are each baked onto their own offscreen canvas first, then
// composited onto the visible canvas via drawImage (which does respect alpha) — this
// keeps the diamond's transparent surroundings from clobbering the ring drawn beneath.
function imageDataToCanvas(data: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  ctx?.putImageData(data, 0, 0)
  return canvas
}

function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#333'
  ctx.stroke()
  ctx.restore()
}

type DragMode = 'ring' | 'diamond' | null

interface ColorWheelProps {
  hex: string
  onChange: (hex: string) => void
}

export function ColorWheel({ hex, onChange }: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ringCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const diamondCanvasRef = useRef<{ hue: number; canvas: HTMLCanvasElement } | null>(null)
  const dragModeRef = useRef<DragMode>(null)
  const [sliderMode, setSliderMode] = useState<'rgb' | 'hsb'>('rgb')

  // No local color state — h/s/v are derived from the hex prop every render, so the
  // wheel always reflects the engine's active color with a single source of truth.
  const { r, g, b } = hexToRgb(hex)
  const { h, s, v } = rgbToHsb(r, g, b)

  // Pointer handlers close over refs (kept fresh every render) instead of h/s/v/onChange
  // directly, so the listeners can be attached once on mount rather than re-attached
  // on every color change.
  const latestRef = useRef({ h, s, v, onChange })
  latestRef.current = { h, s, v, onChange }

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    if (!ringCanvasRef.current) ringCanvasRef.current = imageDataToCanvas(buildRingImageData())
    if (!diamondCanvasRef.current || diamondCanvasRef.current.hue !== h) {
      diamondCanvasRef.current = { hue: h, canvas: imageDataToCanvas(buildDiamondImageData(h)) }
    }

    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.drawImage(ringCanvasRef.current, 0, 0)
    ctx.drawImage(diamondCanvasRef.current.canvas, 0, 0)

    const ringAngle = (h * Math.PI) / 180
    const ringMidRadius = (INNER_RADIUS + OUTER_RADIUS) / 2
    drawHandle(ctx, CENTER + ringMidRadius * Math.cos(ringAngle), CENTER + ringMidRadius * Math.sin(ringAngle))

    const diamondPos = svToPos(s, v)
    drawHandle(ctx, CENTER + diamondPos.dx, CENTER + diamondPos.dy)
  }, [h, s, v])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function offsetFromCenter(e: PointerEvent): { dx: number; dy: number } {
      const rect = canvas!.getBoundingClientRect()
      return { dx: e.clientX - rect.left - CENTER, dy: e.clientY - rect.top - CENTER }
    }

    function applyDrag(dx: number, dy: number): void {
      const { h: curH, s: curS, v: curV, onChange: emit } = latestRef.current
      if (dragModeRef.current === 'ring') {
        let hue = (Math.atan2(dy, dx) * 180) / Math.PI
        if (hue < 0) hue += 360
        const rgb = hsbToRgb(hue, curS, curV)
        emit(rgbToHex(rgb.r, rgb.g, rgb.b))
      } else if (dragModeRef.current === 'diamond') {
        const { s: newS, v: newV } = posToSV(dx, dy)
        const rgb = hsbToRgb(curH, newS, newV)
        emit(rgbToHex(rgb.r, rgb.g, rgb.b))
      }
    }

    function handleDown(e: PointerEvent): void {
      const { dx, dy } = offsetFromCenter(e)
      const dist = Math.hypot(dx, dy)
      if (dist >= INNER_RADIUS - 4 && dist <= OUTER_RADIUS + 4) {
        dragModeRef.current = 'ring'
      } else if (Math.abs(dx) + Math.abs(dy) <= DIAMOND_R + 10) {
        dragModeRef.current = 'diamond'
      } else {
        return
      }
      canvas!.setPointerCapture(e.pointerId)
      applyDrag(dx, dy)
    }

    function handleMove(e: PointerEvent): void {
      if (!dragModeRef.current) return
      const { dx, dy } = offsetFromCenter(e)
      applyDrag(dx, dy)
    }

    function handleUp(): void {
      dragModeRef.current = null
    }

    canvas.addEventListener('pointerdown', handleDown)
    canvas.addEventListener('pointermove', handleMove)
    canvas.addEventListener('pointerup', handleUp)
    canvas.addEventListener('pointercancel', handleUp)
    return () => {
      canvas.removeEventListener('pointerdown', handleDown)
      canvas.removeEventListener('pointermove', handleMove)
      canvas.removeEventListener('pointerup', handleUp)
      canvas.removeEventListener('pointercancel', handleUp)
    }
  }, [])

  function emitRgb(next: { r: number; g: number; b: number }): void {
    onChange(rgbToHex(next.r, next.g, next.b))
  }

  function emitHsb(next: { h: number; s: number; v: number }): void {
    const rgb = hsbToRgb(next.h, next.s, next.v)
    onChange(rgbToHex(rgb.r, rgb.g, rgb.b))
  }

  return (
    <div className="color-wheel">
      <canvas ref={canvasRef} width={SIZE} height={SIZE} className="color-wheel-canvas" />

      <div className="editor-toolbar">
        <button className={sliderMode === 'rgb' ? 'brush-button active' : 'brush-button'} onClick={() => setSliderMode('rgb')}>
          RGB
        </button>
        <button className={sliderMode === 'hsb' ? 'brush-button active' : 'brush-button'} onClick={() => setSliderMode('hsb')}>
          HSB
        </button>
      </div>

      {sliderMode === 'rgb' ? (
        <>
          <label className="slider-control">
            R
            <input type="range" min={0} max={255} value={r} onChange={(e) => emitRgb({ r: Number(e.target.value), g, b })} />
          </label>
          <label className="slider-control">
            G
            <input type="range" min={0} max={255} value={g} onChange={(e) => emitRgb({ r, g: Number(e.target.value), b })} />
          </label>
          <label className="slider-control">
            B
            <input type="range" min={0} max={255} value={b} onChange={(e) => emitRgb({ r, g, b: Number(e.target.value) })} />
          </label>
        </>
      ) : (
        <>
          <label className="slider-control">
            H
            <input type="range" min={0} max={359} value={h} onChange={(e) => emitHsb({ h: Number(e.target.value), s, v })} />
          </label>
          <label className="slider-control">
            S
            <input type="range" min={0} max={100} value={s} onChange={(e) => emitHsb({ h, s: Number(e.target.value), v })} />
          </label>
          <label className="slider-control">
            B
            <input type="range" min={0} max={100} value={v} onChange={(e) => emitHsb({ h, s, v: Number(e.target.value) })} />
          </label>
        </>
      )}
    </div>
  )
}
