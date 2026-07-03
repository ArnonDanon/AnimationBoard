# 002. Vector Rendering Approach

Status: Accepted

## Context

AnimationBoard's internal document model must stay vector (FR-ENGINE-1), and drawing
must feel responsive with pressure-variable stroke width/opacity (FR-BRUSH-2,
NFR-PERF-1). We need to pick what actually paints pixels to the screen from that vector
data. This choice affects hit-testing, onion skin, eraser rendering, and how hard
performance is to hold onto as documents grow.

## Alternatives Considered

- **SVG DOM**: one `<path>` (or similar) element per VectorObject. Vector-native,
  browser gives free hit-testing and accessibility, easy to inspect in devtools.
- **Canvas2D with a custom scene graph**: our Document model stays the source of
  truth (vector data); a hand-written renderer redraws affected Layers to a `<canvas>`
  each time something changes.
- **WebGL/GPU-accelerated (e.g. PixiJS)**: highest ceiling for object count and frame
  rate, at the cost of shader/tessellation work to render variable-width strokes.

## Decision

Canvas2D with a custom scene graph. The document model itself remains vector data
(paths/points) regardless of render target — this decision is only about the paint
step, not about becoming "raster-based."

## Pros / Cons

**Chosen (Canvas2D custom scene graph)**
- Pros: neither SVG's `stroke-width` nor Canvas's `lineWidth` natively varies along a
  single path — a pressure-sensitive stroke requires building an explicit outline
  polygon either way. Given that cost is unavoidable, Canvas2D avoids SVG's per-element
  DOM overhead during high-frequency pointer-move redraws, which is exactly the hot
  path for freehand drawing. `isPointInPath` still gives cheap hit-testing without
  hand-rolled geometry math. Onion skin becomes "draw the previous frame first at low
  alpha" with no architectural change.
- Cons: no free DOM inspection/accessibility tree for objects; more rendering code to
  write and own than SVG would require for the same visual result.

**Rejected (SVG DOM)**
- Pros: less custom rendering code initially; free hit-testing via native DOM.
- Cons: DOM node count and attribute-update overhead scale poorly with high-frequency
  path updates during active drawing — the exact scenario NFR-PERF-1 cares about most.

**Rejected (WebGL/PixiJS)**
- Pros: best long-term performance ceiling.
- Cons: shader/tessellation work for variable-width vector strokes is significant
  upfront cost for a solo developer, disproportionate to POC-scale object counts and
  2–3 concurrent users. Revisit if/when object counts or effects genuinely demand GPU
  acceleration.

## Long-Term Implications

Locks in: a custom Canvas2D renderer as the paint layer, and a scene-graph
abstraction that any future WebGL renderer would need to sit behind (so migrating later
means writing a new renderer against the same scene graph, not rearchitecting the
document model). Keeps open: raster export (canvas → PNG/video) at any point, since
Canvas2D already produces pixels; SVG export remains possible too, since the source
data is vector regardless of render target.
