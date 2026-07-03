import { useEffect, useRef, useState } from 'react'
import { createEngine } from '@animationboard/drawing-engine'
import type { DrawingEngine } from '@animationboard/drawing-engine'
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
    return () => {
      unsubscribe()
      engine.destroy()
      engineRef.current = null
    }
  }, [animatorId])

  const engine = engineRef.current

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <button onClick={() => engine?.undo()}>Undo</button>
        <button onClick={() => engine?.redo()}>Redo</button>
        <span className="divider" />
        <button onClick={() => engine?.setActiveFrameIndex((engine.getActiveFrameIndex() ?? 0) - 1)}>◀</button>
        <span className="frame-indicator">
          Frame {(engine?.getActiveFrameIndex() ?? 0) + 1} / {engine?.getFrameCount() ?? 1}
        </span>
        <button onClick={() => engine?.setActiveFrameIndex((engine.getActiveFrameIndex() ?? 0) + 1)}>▶</button>
        <button onClick={() => engine?.addFrame()}>Add Frame</button>
        <button onClick={() => engine?.addLayer()}>Add Layer</button>
        <span className="divider" />
        <button disabled={!engine?.hasSelection()} onClick={() => engine?.scaleSelection(1.1)}>Scale +</button>
        <button disabled={!engine?.hasSelection()} onClick={() => engine?.scaleSelection(0.9)}>Scale -</button>
        <button disabled={!engine?.hasSelection()} onClick={() => engine?.rotateSelection(-15)}>Rotate ⟲</button>
        <button disabled={!engine?.hasSelection()} onClick={() => engine?.rotateSelection(15)}>Rotate ⟳</button>
      </div>
      <canvas ref={canvasRef} width={900} height={560} className="editor-canvas" />
    </div>
  )
}
