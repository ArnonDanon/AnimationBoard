import { useEffect, useState } from 'react'
import type { DrawingEngine, LayerData } from '@animationboard/drawing-engine'
import './LayerPanel.css'

interface LayerPanelProps {
  engine: DrawingEngine | null
}

export function LayerPanel({ engine }: LayerPanelProps) {
  const layers = engine?.getLayers() ?? []
  const activeIndex = engine?.getActiveLayerIndex() ?? 0

  // Topmost layer (highest index, painted last) is shown first in the list, matching
  // how stacking order is conventionally presented in layer panels.
  const rows = layers.map((layer, index) => ({ layer, index })).reverse()

  return (
    <div className="layer-panel">
      <div className="layer-panel-header">
        <span>Layers</span>
        <button onClick={() => engine?.addLayer(`Layer ${layers.length + 1}`)}>+ Add</button>
      </div>
      <ul className="layer-list">
        {rows.map(({ layer, index }) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            index={index}
            isActive={index === activeIndex}
            isOnly={layers.length === 1}
            isTop={index === layers.length - 1}
            isBottom={index === 0}
            engine={engine}
          />
        ))}
      </ul>
    </div>
  )
}

interface LayerRowProps {
  layer: LayerData
  index: number
  isActive: boolean
  isOnly: boolean
  isTop: boolean
  isBottom: boolean
  engine: DrawingEngine | null
}

function LayerRow({ layer, index, isActive, isOnly, isTop, isBottom, engine }: LayerRowProps) {
  const [nameDraft, setNameDraft] = useState(layer.name)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setNameDraft(layer.name)
  }, [layer.name, editing])

  function commitName() {
    setEditing(false)
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== layer.name) engine?.renameLayer(index, trimmed)
    else setNameDraft(layer.name)
  }

  return (
    <li className={isActive ? 'layer-row active' : 'layer-row'} onClick={() => engine?.setActiveLayerIndex(index)}>
      <button
        className="layer-icon-button"
        title={layer.visible ? 'Hide layer' : 'Show layer'}
        onClick={(e) => { e.stopPropagation(); engine?.setLayerVisible(index, !layer.visible) }}
      >
        {layer.visible ? '👁' : '—'}
      </button>
      <button
        className="layer-icon-button"
        title={layer.locked ? 'Unlock layer' : 'Lock layer'}
        onClick={(e) => { e.stopPropagation(); engine?.setLayerLocked(index, !layer.locked) }}
      >
        {layer.locked ? '🔒' : '🔓'}
      </button>
      {editing ? (
        <input
          className="layer-name-input"
          value={nameDraft}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName()
            if (e.key === 'Escape') { setNameDraft(layer.name); setEditing(false) }
          }}
        />
      ) : (
        <span className="layer-name" onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}>
          {layer.name}
        </span>
      )}
      <button className="layer-icon-button" title="Move up" disabled={isTop} onClick={(e) => { e.stopPropagation(); engine?.moveLayerUp(index) }}>▲</button>
      <button className="layer-icon-button" title="Move down" disabled={isBottom} onClick={(e) => { e.stopPropagation(); engine?.moveLayerDown(index) }}>▼</button>
      <button className="layer-icon-button" title="Duplicate layer" onClick={(e) => { e.stopPropagation(); engine?.duplicateLayer(index) }}>⧉</button>
      <button className="layer-icon-button" title="Delete layer" disabled={isOnly} onClick={(e) => { e.stopPropagation(); engine?.deleteLayer(index) }}>🗑</button>
    </li>
  )
}
