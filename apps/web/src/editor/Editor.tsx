import { useEffect, useRef, useState } from 'react'
import { BUILT_IN_BRUSHES, BUILT_IN_PALETTE, createEngine } from '@animationboard/drawing-engine'
import type { DrawingEngine } from '@animationboard/drawing-engine'
import { LayerPanel } from './LayerPanel'
import { Timeline } from './Timeline'
import './Editor.css'

interface EditorProps {
  animatorId: string
}

export function Editor({ animatorId }: EditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<DrawingEngine | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    if (!canvasRef.current) return
    const engine = createEngine({ canvas: canvasRef.current, animatorId })
    engineRef.current = engine
    const unsubscribe = engine.onChange(() => tick((n) => n + 1))
    tick((n) => n + 1) // re-render now that engineRef is populated (ref writes don't trigger one)
    return () => {
      unsubscribe()
      engine.destroy()
      engineRef.current = null
    }
  }, [animatorId])

  const engine = engineRef.current
  const activeTool = engine?.getActiveTool() ?? 'brush'

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <button onClick={() => engine?.undo()}>Undo</button>
        <button onClick={() => engine?.redo()}>Redo</button>
        <span className="divider" />
        <button disabled={!engine?.hasSelection()} onClick={() => engine?.scaleSelection(1.1)}>Scale +</button>
        <button disabled={!engine?.hasSelection()} onClick={() => engine?.scaleSelection(0.9)}>Scale -</button>
        <button disabled={!engine?.hasSelection()} onClick={() => engine?.rotateSelection(-15)}>Rotate ⟲</button>
        <button disabled={!engine?.hasSelection()} onClick={() => engine?.rotateSelection(15)}>Rotate ⟳</button>
      </div>

      <div className="editor-toolbar">
        <button
          className={activeTool === 'brush' ? 'brush-button active' : 'brush-button'}
          onClick={() => engine?.setActiveTool('brush')}
        >
          Brush
        </button>
        <button
          className={activeTool === 'select' ? 'brush-button active' : 'brush-button'}
          onClick={() => engine?.setActiveTool('select')}
        >
          Select
        </button>
        <button
          className={activeTool === 'eraser' ? 'brush-button active' : 'brush-button'}
          onClick={() => engine?.setActiveTool('eraser')}
        >
          Eraser
        </button>
        {activeTool === 'eraser' && (
          <label className="slider-control">
            Size
            <input
              type="range"
              min={4}
              max={40}
              value={engine?.getEraserRadius() ?? 12}
              onChange={(e) => engine?.setEraserRadius(Number(e.target.value))}
            />
          </label>
        )}
        <span className="divider" />
        {BUILT_IN_BRUSHES.map((brush) => (
          <button
            key={brush.id}
            disabled={activeTool !== 'brush'}
            className={activeTool === 'brush' && engine?.getActiveBrush().id === brush.id ? 'brush-button active' : 'brush-button'}
            title={brush.pressureSensitive ? `${brush.name} (pressure: ${brush.pressureAffects})` : brush.name}
            onClick={() => engine?.setActiveBrush(brush)}
          >
            {brush.name}
          </button>
        ))}
        <label className="slider-control">
          Size
          <input
            type="range"
            min={1}
            max={30}
            disabled={activeTool !== 'brush'}
            value={engine?.getActiveBrush().baseWidth ?? 1}
            onChange={(e) => engine?.setBrushSize(Number(e.target.value))}
          />
        </label>
        <label className="slider-control">
          Opacity
          <input
            type="range"
            min={5}
            max={100}
            disabled={activeTool !== 'brush'}
            value={Math.round((engine?.getActiveBrush().opacity ?? 1) * 100)}
            onChange={(e) => engine?.setBrushOpacity(Number(e.target.value) / 100)}
          />
        </label>
        <span className="divider" />
        {BUILT_IN_PALETTE.map((color) => (
          <button
            key={color}
            disabled={activeTool !== 'brush'}
            className={activeTool === 'brush' && engine?.getActiveColor() === color ? 'swatch active' : 'swatch'}
            style={{ backgroundColor: color }}
            aria-label={color}
            onClick={() => engine?.setActiveColor(color)}
          />
        ))}
      </div>

      <div className="editor-body">
        <canvas
          ref={canvasRef}
          width={900}
          height={560}
          className={activeTool === 'eraser' ? 'editor-canvas erasing' : `editor-canvas ${activeTool}`}
        />
        <LayerPanel engine={engine} />
      </div>

      <Timeline engine={engine} />
    </div>
  )
}
