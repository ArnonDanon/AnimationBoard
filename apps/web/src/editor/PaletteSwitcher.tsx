import { useEffect, useState } from 'react'
import type { DrawingEngine } from '@animationboard/drawing-engine'
import { createPalette, deletePalette, listPalettes, updatePalette } from '../api/client'
import type { PaletteSummary } from '../api/client'
import './PaletteSwitcher.css'

interface PaletteSwitcherProps {
  engine: DrawingEngine | null
  usesActiveColor: boolean
}

export function PaletteSwitcher({ engine, usesActiveColor }: PaletteSwitcherProps) {
  const [palettes, setPalettes] = useState<PaletteSummary[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listPalettes()
      .then((res) => {
        setPalettes(res.palettes)
        if (res.palettes.length > 0) setSelectedId(res.palettes[0].paletteId)
      })
      .catch((e) => setError((e as Error).message))
  }, [])

  const selected = palettes?.find((p) => p.paletteId === selectedId) ?? null

  async function handleCreate() {
    try {
      const palette = await createPalette('Untitled Palette')
      setPalettes((prev) => [...(prev ?? []), palette])
      setSelectedId(palette.paletteId)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleRename() {
    if (!selected) return
    const name = window.prompt('Rename palette', selected.name)
    if (!name || !name.trim() || name.trim() === selected.name) return
    try {
      await updatePalette(selected.paletteId, { name: name.trim() })
      setPalettes((prev) => prev?.map((p) => (p.paletteId === selected.paletteId ? { ...p, name: name.trim() } : p)) ?? null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleDelete() {
    if (!selected) return
    if (!window.confirm(`Delete palette "${selected.name}"? This cannot be undone.`)) return
    try {
      await deletePalette(selected.paletteId)
      setPalettes((prev) => {
        const next = prev?.filter((p) => p.paletteId !== selected.paletteId) ?? null
        setSelectedId(next && next.length > 0 ? next[0].paletteId : null)
        return next
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleAddCurrentColor() {
    if (!selected || !engine) return
    const color = engine.getActiveColor()
    if (selected.colors.includes(color)) return
    const colors = [...selected.colors, color]
    try {
      await updatePalette(selected.paletteId, { colors })
      setPalettes((prev) => prev?.map((p) => (p.paletteId === selected.paletteId ? { ...p, colors } : p)) ?? null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (palettes === null) return null

  return (
    <div className="editor-toolbar palette-switcher">
      {error && <span className="dashboard-error">{error}</span>}
      <select value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value || null)} disabled={palettes.length === 0}>
        {palettes.length === 0 && <option value="">No custom palettes yet</option>}
        {palettes.map((p) => (
          <option key={p.paletteId} value={p.paletteId}>
            {p.name}
          </option>
        ))}
      </select>
      <button onClick={handleCreate}>+ New Palette</button>
      {selected && (
        <>
          <button onClick={handleRename}>Rename</button>
          <button onClick={handleDelete}>Delete</button>
          <button disabled={!usesActiveColor} onClick={handleAddCurrentColor}>
            + Add current color
          </button>
          {selected.colors.map((color) => (
            <button
              key={color}
              disabled={!usesActiveColor}
              className={usesActiveColor && engine?.getActiveColor() === color ? 'swatch active' : 'swatch'}
              style={{ backgroundColor: color }}
              aria-label={color}
              onClick={() => engine?.setActiveColor(color)}
            />
          ))}
        </>
      )}
    </div>
  )
}
