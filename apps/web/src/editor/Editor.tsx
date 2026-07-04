import { useEffect, useRef, useState } from 'react'
import { BUILT_IN_BRUSHES, BUILT_IN_PALETTE, createDocumentFromSnapshot, createEngine, createRealtimeProvider } from '@animationboard/drawing-engine'
import type { DrawingEngine, RealtimeProvider } from '@animationboard/drawing-engine'
import { getIdToken, getProject, loadDocument, saveDocument } from '../api/client'
import { LayerPanel } from './LayerPanel'
import { Timeline } from './Timeline'
import './Editor.css'

// Debounce autosave rather than saving on every stroke point — bounds the data-loss
// window (NFR-DATA-1) without hammering the API while the user is actively drawing.
const AUTOSAVE_DEBOUNCE_MS = 2500

const WS_API_URL = import.meta.env.VITE_WS_API_URL as string | undefined

interface EditorProps {
  animatorId: string
  projectId: string
  onBack: () => void
}

type LoadState = 'loading' | 'ready' | 'error'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function Editor({ animatorId, projectId, onBack }: EditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<DrawingEngine | null>(null)
  const [, tick] = useState(0)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [projectName, setProjectName] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    let cancelled = false
    let debounceHandle: ReturnType<typeof setTimeout> | null = null
    let pendingBytes: Uint8Array | null = null
    let unsubscribeTick: (() => void) | null = null
    let unsubscribeAutosave: (() => void) | null = null
    let realtimeProvider: RealtimeProvider | null = null

    setLoadState('loading')
    setSaveStatus('idle')

    function flush() {
      if (!pendingBytes) return
      const bytes = pendingBytes
      pendingBytes = null
      setSaveStatus('saving')
      saveDocument(projectId, bytes)
        .then(() => !cancelled && setSaveStatus('saved'))
        .catch(() => !cancelled && setSaveStatus('error'))
    }

    async function init() {
      const [snapshot, detail] = await Promise.all([loadDocument(projectId), getProject(projectId)])
      if (cancelled || !canvasRef.current) return

      const doc = createDocumentFromSnapshot(snapshot)
      const engine = createEngine({ canvas: canvasRef.current, animatorId, doc })
      engineRef.current = engine
      setProjectName(detail.name)

      unsubscribeTick = engine.onChange(() => tick((n) => n + 1))
      unsubscribeAutosave = engine.onChange(() => {
        pendingBytes = engine.exportSnapshot()
        if (debounceHandle) clearTimeout(debounceHandle)
        debounceHandle = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS)
      })

      setLoadState('ready')
      tick((n) => n + 1)

      if (WS_API_URL) {
        const token = await getIdToken()
        if (!cancelled && token) {
          const url = `${WS_API_URL}?token=${encodeURIComponent(token)}&projectId=${encodeURIComponent(projectId)}`
          realtimeProvider = createRealtimeProvider({ doc: engine.doc, url })
        }
      }
    }

    init().catch(() => !cancelled && setLoadState('error'))

    return () => {
      cancelled = true
      if (debounceHandle) clearTimeout(debounceHandle)
      flush() // best-effort final save when navigating away or switching projects
      unsubscribeTick?.()
      unsubscribeAutosave?.()
      realtimeProvider?.destroy()
      if (engineRef.current) {
        engineRef.current.destroy()
        engineRef.current = null
      }
    }
  }, [projectId, animatorId])

  const engine = engineRef.current
  const activeTool = engine?.getActiveTool() ?? 'brush'

  if (loadState === 'error') {
    return (
      <div className="editor">
        <p className="dashboard-error">Failed to load this project.</p>
        <button onClick={onBack}>← Back to projects</button>
      </div>
    )
  }

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <button onClick={onBack}>← Back to projects</button>
        <span className="project-title">{projectName}</span>
        <span className="save-status">
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'error' && 'Save failed'}
        </span>
        <span className="divider" />
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
        <button
          className={activeTool === 'colorPicker' ? 'brush-button active' : 'brush-button'}
          title="Sample a color from the canvas"
          onClick={() => engine?.setActiveTool('colorPicker')}
        >
          🎨 Pick
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
        <span className="divider" />
        <span
          className="swatch current-color"
          title={`Current color: ${engine?.getActiveColor() ?? ''}`}
          style={{ backgroundColor: engine?.getActiveColor() }}
        />
      </div>

      <div className="editor-body">
        {loadState === 'loading' && <div className="editor-loading-overlay">Loading project…</div>}
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
