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

export function paintStroke(ctx: CanvasRenderingContext2D, points: Point[], style: Style, transform: Transform): void {
  const path = buildStrokePath(points);
  withObjectTransform(ctx, transform, () => {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.globalAlpha = style.opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  });
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
