import { getLayersArray, getObjectsArray, vectorObjectToData } from './document';
import type { YFrame, YObject } from './document';
import { buildStrokePath, withObjectTransform } from './render';

const MIN_HIT_WIDTH = 8;

export function hitTestObject(ctx: CanvasRenderingContext2D, obj: YObject, x: number, y: number): boolean {
  const data = vectorObjectToData(obj);
  const path = buildStrokePath(data.points);
  let hit = false;
  withObjectTransform(ctx, data.transform, () => {
    ctx.lineWidth = Math.max(data.style.width, MIN_HIT_WIDTH);
    hit = ctx.isPointInStroke(path, x, y);
  });
  return hit;
}

export function hitTestFrame(ctx: CanvasRenderingContext2D, frame: YFrame, x: number, y: number): YObject | null {
  const layers = getLayersArray(frame);
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers.get(i);
    if (layer.get('visible') !== true) continue;
    const objects = getObjectsArray(layer);
    for (let j = objects.length - 1; j >= 0; j--) {
      const obj = objects.get(j);
      if (hitTestObject(ctx, obj, x, y)) return obj;
    }
  }
  return null;
}
