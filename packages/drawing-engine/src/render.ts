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

export function withObjectTransform(ctx: CanvasRenderingContext2D, transform: Transform, fn: () => void): void {
  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.scaleX, transform.scaleY);
  fn();
  ctx.restore();
}

function paintStrokeSegments(ctx: CanvasRenderingContext2D, points: Point[], style: Style, transform: Transform): void {
  withObjectTransform(ctx, transform, () => {
    ctx.strokeStyle = style.color;
    ctx.fillStyle = style.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1) {
      const radius = (style.widths?.[0] ?? style.width) / 2;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Pressure-sensitive width varies per point, so each segment is stroked with its
    // own interpolated width and round caps — much simpler than building a mitered
    // variable-width outline polygon, and visually equivalent for a POC brush.
    const widths = style.widths && style.widths.length === points.length ? style.widths : points.map(() => style.width);
    for (let i = 1; i < points.length; i++) {
      ctx.lineWidth = (widths[i - 1] + widths[i]) / 2;
      ctx.beginPath();
      ctx.moveTo(points[i - 1].x, points[i - 1].y);
      ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
  });
}

export function paintStroke(ctx: CanvasRenderingContext2D, points: Point[], style: Style, transform: Transform): void {
  if (points.length === 0) return;

  // Adjacent round-capped segments overlap where they join, so stroking them
  // directly with globalAlpha < 1 double-composites alpha at every overlap,
  // making a translucent stroke look blotchy instead of uniformly translucent.
  // Painting the whole stroke opaque on an offscreen layer first, then
  // compositing that layer once with the style's opacity, avoids it.
  if (style.opacity >= 1) {
    paintStrokeSegments(ctx, points, style, transform);
    return;
  }

  const layer = document.createElement('canvas');
  layer.width = ctx.canvas.width;
  layer.height = ctx.canvas.height;
  const layerCtx = layer.getContext('2d');
  if (!layerCtx) return;
  paintStrokeSegments(layerCtx, points, style, transform);

  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.drawImage(layer, 0, 0);
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
  paintStroke(ctx, data.points, data.style, data.transform);
}

export function renderFrame(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, frame: YFrame): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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
