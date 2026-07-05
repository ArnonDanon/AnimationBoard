import { getLayersArray, getObjectsArray, vectorObjectToData } from './document';
import type { YFrame, YLayer, YObject } from './document';
import type { Point, Style, Transform } from './types';

export function buildStrokePath(points: Point[]): Path2D {
  const path = new Path2D();
  if (points.length === 0) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    path.lineTo(points[i].x, points[i].y);
  }
  return path;
}

/** `points` is the shape's 2 opposite bounding-box corners (see VectorObjectData.kind). */
export function buildRectPath(points: Point[]): Path2D {
  const path = new Path2D();
  if (points.length < 2) return path;
  const box = getBoundingBox(points);
  path.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
  return path;
}

/** Ellipse inscribed in the bounding box defined by the shape's 2 opposite corners. */
export function buildEllipsePath(points: Point[]): Path2D {
  const path = new Path2D();
  if (points.length < 2) return path;
  const box = getBoundingBox(points);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const rx = (box.maxX - box.minX) / 2;
  const ry = (box.maxY - box.minY) / 2;
  path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  return path;
}

/** `rings` is [outer, ...holes] per polygon, one or more polygons flattened into one Path2D —
 *  callers use the 'evenodd' fill rule so hole-vs-outer winding direction never has to be tracked. */
export function buildFilledPathPath(rings: Point[][]): Path2D {
  const path = new Path2D();
  for (const ring of rings) {
    if (ring.length === 0) continue;
    path.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].x, ring[i].y);
    path.closePath();
  }
  return path;
}

/** Center of an object's own geometry — the pivot rotation/scale should spin around, as
 *  opposed to `transform.x/y` (a plain translation offset, not a pivot point). */
export function getTransformPivot(points: Point[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  const box = getBoundingBox(points);
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

export function withObjectTransform(
  ctx: CanvasRenderingContext2D,
  transform: Transform,
  pivot: { x: number; y: number },
  fn: () => void,
): void {
  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.translate(pivot.x, pivot.y);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.scaleX, transform.scaleY);
  ctx.translate(-pivot.x, -pivot.y);
  fn();
  ctx.restore();
}

function isUniformWidth(style: Style, pointCount: number): boolean {
  if (!style.widths || style.widths.length !== pointCount || pointCount === 0) return true;
  return style.widths.every((w) => w === style.widths![0]);
}

function paintDot(ctx: CanvasRenderingContext2D, point: Point, radius: number, style: Style, transform: Transform): void {
  withObjectTransform(ctx, transform, getTransformPivot([point]), () => {
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.opacity;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

// A single Path2D stroked once composites as one shape, so uniform-width strokes
// (the common case) never need the overlap-alpha workaround below — this is also
// far cheaper than segment-by-segment stroking for anything beyond a handful of points.
function paintUniformStroke(ctx: CanvasRenderingContext2D, points: Point[], width: number, style: Style, transform: Transform): void {
  const path = buildStrokePath(points);
  const capStart = style.capStart ?? true;
  const capEnd = style.capEnd ?? true;
  withObjectTransform(ctx, transform, getTransformPivot(points), () => {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = width;
    ctx.globalAlpha = style.opacity;
    ctx.lineJoin = 'round';
    // Canvas can't give a path's two ends different lineCaps in one stroke() call — draw flat
    // (butt) and, if exactly one end is a true tip (see eraser.ts's eraseStroke), manually add
    // that one end's round-cap disc after, in the same paint pass (same alpha, one composite).
    ctx.lineCap = capStart && capEnd ? 'round' : 'butt';
    ctx.stroke(path);
    if (capStart !== capEnd) {
      const tip = capStart ? points[0] : points[points.length - 1];
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function paintVariableWidthSegments(ctx: CanvasRenderingContext2D, points: Point[], widths: number[], style: Style, transform: Transform): void {
  const capStart = style.capStart ?? true;
  const capEnd = style.capEnd ?? true;
  // Only a single-segment (2-point) stroke has no neighboring segment to independently supply
  // a shared joint's round cap — every other stroke can safely flatten just the *true* outer
  // tip on its own segment and rely on the neighboring segment's own unconditional round cap to
  // still cover that shared internal joint (exactly as before this existed — flattening one
  // side of a joint that's still independently covered from the other side changes nothing
  // visible there).
  const singleSegment = points.length === 2;
  withObjectTransform(ctx, transform, getTransformPivot(points), () => {
    ctx.strokeStyle = style.color;
    ctx.lineJoin = 'round';
    for (let i = 1; i < points.length; i++) {
      const segCapStart = i === 1 ? capStart : true;
      const segCapEnd = i === points.length - 1 ? capEnd : true;
      ctx.lineWidth = (widths[i - 1] + widths[i]) / 2;
      ctx.lineCap = segCapStart && segCapEnd ? 'round' : 'butt';
      ctx.beginPath();
      ctx.moveTo(points[i - 1].x, points[i - 1].y);
      ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
      if (singleSegment && segCapStart !== segCapEnd) {
        const tip = segCapStart ? points[i - 1] : points[i];
        const tipWidth = segCapStart ? widths[i - 1] : widths[i];
        ctx.fillStyle = style.color;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, tipWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

// Reused across calls instead of allocating a full-size canvas per translucent
// object per render — that allocation was the dominant cost under any real load
// (measured ~150x slower for a stress test of overlapping translucent strokes).
let scratchLayer: HTMLCanvasElement | null = null;
function getScratchLayer(width: number, height: number): HTMLCanvasElement {
  if (!scratchLayer) scratchLayer = document.createElement('canvas');
  if (scratchLayer.width !== width || scratchLayer.height !== height) {
    scratchLayer.width = width;
    scratchLayer.height = height;
  }
  return scratchLayer;
}

// A *separate* buffer from the one above, needed because renderOnionSkin uses a
// scratch canvas to accumulate an entire frame's worth of objects, while paintStroke
// (called for each of those objects in turn) also reaches for a scratch canvas of its
// own for a single translucent/variable-width stroke's compositing. Sharing one
// canvas between an "accumulate many objects" use and a "compositing one object"
// use nested inside it meant painting a translucent stroke mid-frame would clearRect
// away every onion-frame object already drawn before it — a real bug (only the
// objects painted *after* the last such stroke survived to be composited).
let onionScratchLayer: HTMLCanvasElement | null = null;
function getOnionScratchLayer(width: number, height: number): HTMLCanvasElement {
  if (!onionScratchLayer) onionScratchLayer = document.createElement('canvas');
  if (onionScratchLayer.width !== width || onionScratchLayer.height !== height) {
    onionScratchLayer.width = width;
    onionScratchLayer.height = height;
  }
  return onionScratchLayer;
}

export function paintStroke(ctx: CanvasRenderingContext2D, points: Point[], style: Style, transform: Transform): void {
  if (points.length === 0) return;

  if (points.length === 1) {
    paintDot(ctx, points[0], (style.widths?.[0] ?? style.width) / 2, style, transform);
    return;
  }

  if (isUniformWidth(style, points.length)) {
    paintUniformStroke(ctx, points, style.widths?.[0] ?? style.width, style, transform);
    return;
  }

  // Width varies per point, so it's stroked segment-by-segment (see
  // paintVariableWidthSegments) — but adjacent round-capped segments overlap where
  // they join, so stroking them directly under globalAlpha < 1 double-composites
  // alpha at every overlap. Painting opaque to a scratch layer first, then
  // compositing once at the real opacity, avoids that. Skipped when fully opaque,
  // since compositing opaque fills twice is a no-op.
  const widths = style.widths!;
  if (style.opacity >= 1) {
    paintVariableWidthSegments(ctx, points, widths, style, transform);
    return;
  }

  const layer = getScratchLayer(ctx.canvas.width, ctx.canvas.height);
  const layerCtx = layer.getContext('2d');
  if (!layerCtx) return;
  layerCtx.clearRect(0, 0, layer.width, layer.height);
  paintVariableWidthSegments(layerCtx, points, widths, style, transform);

  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

// Shapes are solid-fill-only in this basic version (no outline mode) — mirrors how a
// brush stroke is solid ink, per the eraser's own precedent of documenting deferred
// features rather than building them speculatively.
export function paintRect(ctx: CanvasRenderingContext2D, points: Point[], style: Style, transform: Transform): void {
  if (points.length < 2) return;
  withObjectTransform(ctx, transform, getTransformPivot(points), () => {
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.opacity;
    ctx.fill(buildRectPath(points));
  });
}

export function paintEllipse(ctx: CanvasRenderingContext2D, points: Point[], style: Style, transform: Transform): void {
  if (points.length < 2) return;
  withObjectTransform(ctx, transform, getTransformPivot(points), () => {
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.opacity;
    ctx.fill(buildEllipsePath(points));
  });
}

/** Erase results — one or more filled polygons (each possibly with holes) baked into world space. */
export function paintFilledPath(ctx: CanvasRenderingContext2D, rings: Point[][], style: Style, transform: Transform): void {
  if (rings.length === 0) return;
  withObjectTransform(ctx, transform, getTransformPivot(rings.flat()), () => {
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.opacity;
    ctx.fill(buildFilledPathPath(rings), 'evenodd');
  });
}

// A translucent "heat zone" disc showing exactly what the eraser's radius will
// reach, plus a thin crosshair pinpointing the exact center — the disc scales
// with the eraser size, so it's obvious at a glance whether it'll reach a stroke.
export function paintEraserCursor(ctx: CanvasRenderingContext2D, point: { x: number; y: number }, radius: number): void {
  ctx.save();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(230, 40, 40, 0.16)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 20, 20, 0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const armLength = 5;
  ctx.strokeStyle = 'rgba(200, 20, 20, 0.95)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(point.x - armLength, point.y);
  ctx.lineTo(point.x + armLength, point.y);
  ctx.moveTo(point.x, point.y - armLength);
  ctx.lineTo(point.x, point.y + armLength);
  ctx.stroke();

  ctx.restore();
}

export function getBoundingBox(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function paintSelectionOutline(ctx: CanvasRenderingContext2D, points: Point[], transform: Transform): void {
  const box = getBoundingBox(points);
  withObjectTransform(ctx, transform, getTransformPivot(points), () => {
    ctx.save();
    ctx.strokeStyle = '#3355dd';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(box.minX - 4, box.minY - 4, box.maxX - box.minX + 8, box.maxY - box.minY + 8);
    ctx.restore();
  });
}

export function renderObject(ctx: CanvasRenderingContext2D, obj: YObject): void {
  const data = vectorObjectToData(obj);
  if (data.kind === 'rectangle') paintRect(ctx, data.points, data.style, data.transform);
  else if (data.kind === 'ellipse') paintEllipse(ctx, data.points, data.style, data.transform);
  else if (data.kind === 'filledPath') paintFilledPath(ctx, data.rings ?? [], data.style, data.transform);
  else paintStroke(ctx, data.points, data.style, data.transform);
}

/** A single layer's own objects, with no clear — used both by paintFrameLayers and by
 *  layer-thumbnail rendering (which needs one layer's content in isolation). */
export function paintLayerObjects(ctx: CanvasRenderingContext2D, layer: YLayer): void {
  const objects = getObjectsArray(layer);
  for (let j = 0; j < objects.length; j++) {
    renderObject(ctx, objects.get(j));
  }
}

/**
 * The layer/object painting loop, with no clear — see renderFrame/renderOnionSkin.
 * `activeLayerIndex`/`liveExtra` let a caller (the engine's live-stroke/live-shape
 * preview) inject an extra paint at the exact z-position of the active layer, instead
 * of always drawing it on top of every layer regardless of stacking order.
 */
export function paintFrameLayers(ctx: CanvasRenderingContext2D, frame: YFrame, activeLayerIndex?: number, liveExtra?: () => void): void {
  const layers = getLayersArray(frame);
  for (let i = 0; i < layers.length; i++) {
    const layer = layers.get(i);
    if (layer.get('visible') === true) paintLayerObjects(ctx, layer);
    if (i === activeLayerIndex) liveExtra?.();
  }
}

/**
 * Paints a frame's layers fully opaque to a dedicated scratch canvas (kept separate
 * from paintStroke's own — see getOnionScratchLayer's comment for why they can't
 * share one), then composites that once onto `ctx` at `opacity`. This dims the whole
 * frame uniformly while preserving relative opacity differences between its own
 * objects, rather than flattening every object to the same alpha.
 */
export function renderOnionSkin(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, frame: YFrame, opacity: number): void {
  const layer = getOnionScratchLayer(canvas.width, canvas.height);
  const layerCtx = layer.getContext('2d');
  if (!layerCtx) return;
  layerCtx.clearRect(0, 0, layer.width, layer.height);
  paintFrameLayers(layerCtx, frame);

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}
