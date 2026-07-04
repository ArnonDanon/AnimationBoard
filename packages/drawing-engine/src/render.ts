import { getLayersArray, getObjectsArray, vectorObjectToData } from './document';
import type { YFrame, YObject } from './document';
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

export function withObjectTransform(ctx: CanvasRenderingContext2D, transform: Transform, fn: () => void): void {
  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.scaleX, transform.scaleY);
  fn();
  ctx.restore();
}

function isUniformWidth(style: Style, pointCount: number): boolean {
  if (!style.widths || style.widths.length !== pointCount || pointCount === 0) return true;
  return style.widths.every((w) => w === style.widths![0]);
}

function paintDot(ctx: CanvasRenderingContext2D, point: Point, radius: number, style: Style, transform: Transform): void {
  withObjectTransform(ctx, transform, () => {
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
  withObjectTransform(ctx, transform, () => {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = width;
    ctx.globalAlpha = style.opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  });
}

function paintVariableWidthSegments(ctx: CanvasRenderingContext2D, points: Point[], widths: number[], style: Style, transform: Transform): void {
  withObjectTransform(ctx, transform, () => {
    ctx.strokeStyle = style.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < points.length; i++) {
      ctx.lineWidth = (widths[i - 1] + widths[i]) / 2;
      ctx.beginPath();
      ctx.moveTo(points[i - 1].x, points[i - 1].y);
      ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
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
  withObjectTransform(ctx, transform, () => {
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.opacity;
    ctx.fill(buildRectPath(points));
  });
}

export function paintEllipse(ctx: CanvasRenderingContext2D, points: Point[], style: Style, transform: Transform): void {
  if (points.length < 2) return;
  withObjectTransform(ctx, transform, () => {
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.opacity;
    ctx.fill(buildEllipsePath(points));
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
  withObjectTransform(ctx, transform, () => {
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
  else paintStroke(ctx, data.points, data.style, data.transform);
}

/** The layer/object painting loop, with no clear — see renderFrame/renderOnionSkin. */
export function paintFrameLayers(ctx: CanvasRenderingContext2D, frame: YFrame): void {
  const layers = getLayersArray(frame);
  for (let i = 0; i < layers.length; i++) {
    const layer = layers.get(i);
    if (layer.get('visible') !== true) continue;
    const objects = getObjectsArray(layer);
    for (let j = 0; j < objects.length; j++) {
      renderObject(ctx, objects.get(j));
    }
  }
}

export function renderFrame(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, frame: YFrame): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paintFrameLayers(ctx, frame);
}

/**
 * Paints a frame's layers fully opaque to the shared scratch canvas, then composites
 * that once onto `ctx` at `opacity` — the same double-alpha-compositing avoidance
 * `paintStroke` already uses for translucent variable-width strokes (see its comment).
 * This dims the whole frame uniformly while preserving relative opacity differences
 * between its own objects, rather than flattening every object to the same alpha.
 */
export function renderOnionSkin(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, frame: YFrame, opacity: number): void {
  const layer = getScratchLayer(canvas.width, canvas.height);
  const layerCtx = layer.getContext('2d');
  if (!layerCtx) return;
  layerCtx.clearRect(0, 0, layer.width, layer.height);
  paintFrameLayers(layerCtx, frame);

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}
