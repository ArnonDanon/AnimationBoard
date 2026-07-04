import { useEffect, useState } from 'react'
import type { DrawingEngine, FrameData } from '@animationboard/drawing-engine'
import './Timeline.css'

interface TimelineProps {
  engine: DrawingEngine | null
}

export function Timeline({ engine }: TimelineProps) {
  const frames = engine?.getFrames() ?? []
  const activeIndex = engine?.getActiveFrameIndex() ?? 0
  const isPlaying = engine?.getIsPlaying() ?? false
  const fps = engine?.getFps() ?? 12

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button onClick={() => (isPlaying ? engine?.pause() : engine?.play())} disabled={frames.length <= 1}>
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <label className="fps-control">
          FPS
          <input
            type="number"
            min={1}
            max={60}
            value={fps}
            onChange={(e) => engine?.setFps(Number(e.target.value))}
          />
        </label>
        <button onClick={() => engine?.addFrame(`Frame ${frames.length + 1}`)}>+ Add Frame</button>
      </div>
      <ul className="frame-strip">
        {frames.map((frame, index) => (
          <FrameCard
            key={frame.id}
            frame={frame}
            index={index}
            isActive={index === activeIndex}
            isOnly={frames.length === 1}
            isFirst={index === 0}
            isLast={index === frames.length - 1}
            engine={engine}
          />
        ))}
      </ul>
    </div>
  )
}

interface FrameCardProps {
  frame: FrameData
  index: number
  isActive: boolean
  isOnly: boolean
  isFirst: boolean
  isLast: boolean
  engine: DrawingEngine | null
}

function FrameCard({ frame, index, isActive, isOnly, isFirst, isLast, engine }: FrameCardProps) {
  const [nameDraft, setNameDraft] = useState(frame.name)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setNameDraft(frame.name)
  }, [frame.name, editing])

  function commitName() {
    setEditing(false)
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== frame.name) engine?.renameFrame(index, trimmed)
    else setNameDraft(frame.name)
  }

  return (
    <li className={isActive ? 'frame-card active' : 'frame-card'} onClick={() => engine?.setActiveFrameIndex(index)}>
      {editing ? (
        <input
          className="frame-name-input"
          value={nameDraft}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName()
            if (e.key === 'Escape') { setNameDraft(frame.name); setEditing(false) }
          }}
        />
      ) : (
        <span className="frame-name" onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}>
          {frame.name}
        </span>
      )}
      <div className="frame-card-actions">
        <button disabled={isFirst} title="Move earlier" onClick={(e) => { e.stopPropagation(); engine?.moveFrameEarlier(index) }}>◀</button>
        <button title="Duplicate frame" onClick={(e) => { e.stopPropagation(); engine?.duplicateFrame(index) }}>⧉</button>
        <button disabled={isOnly} title="Delete frame" onClick={(e) => { e.stopPropagation(); engine?.deleteFrame(index) }}>🗑</button>
        <button disabled={isLast} title="Move later" onClick={(e) => { e.stopPropagation(); engine?.moveFrameLater(index) }}>▶</button>
      </div>
    </li>
  )
}
