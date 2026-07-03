import { describe, expect, it } from 'vitest';
import { eraseFromLayer, eraseFromObjectData } from './eraser';
import { addLayer, createDocument, createVectorObject, getFramesArray, getLayersArray, getObjectsArray, vectorObjectToData } from './document';
import { DEFAULT_TRANSFORM } from './types';
import type { VectorObjectData } from './types';

function makeStroke(points: { x: number; y: number }[]): VectorObjectData {
  return {
    id: 'stroke-1',
    kind: 'stroke',
    points: points.map((p) => ({ ...p, pressure: 1 })),
    style: { color: '#000', width: 4, opacity: 1 },
    transform: { ...DEFAULT_TRANSFORM },
    createdBy: 'animator-1',
  };
}

describe('eraseFromObjectData', () => {
  it('returns null when the eraser path misses the stroke entirely', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 1000, y: 1000 }], 5);
    expect(result).toBeNull();
  });

  it('returns an empty array when the eraser fully covers the stroke (whole-object removal, not a special case)', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 0, y: 0 }, { x: 10, y: 0 }], 5);
    expect(result).toEqual([]);
  });

  it('splits a stroke into two fragments when the eraser cuts through the middle', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 40, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 20, y: 0 }], 3);
    expect(result).toHaveLength(2);
    expect(result![0].points.map((p) => p.x)).toEqual([0, 10]);
    expect(result![1].points.map((p) => p.x)).toEqual([30, 40]);
  });

  it('trims just one end when the eraser only touches the tail', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 20, y: 0 }], 3);
    expect(result).toHaveLength(1);
    expect(result![0].points.map((p) => p.x)).toEqual([0, 10]);
  });

  it('bakes the object transform into surviving fragment points and resets to identity', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    stroke.transform = { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0 };
    const result = eraseFromObjectData(stroke, [{ x: 9999, y: 9999 }], 3); // misses in world space
    expect(result).toBeNull(); // untouched since eraser is nowhere near the translated stroke

    const hit = eraseFromObjectData(stroke, [{ x: 100, y: 50 }], 3); // right at the translated first point
    expect(hit).toHaveLength(1);
    expect(hit![0].transform).toEqual(DEFAULT_TRANSFORM);
    expect(hit![0].points[0].x).toBe(110); // 10 (local) + 100 (translate) — the surviving second point
  });

  it('slices per-point widths so a pressure-sensitive stroke keeps its correct widths after a split', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
    stroke.style.widths = [2, 4, 6];
    const result = eraseFromObjectData(stroke, [{ x: 10, y: 0 }], 3);
    expect(result).toHaveLength(2);
    expect(result![0].style.widths).toEqual([2]);
    expect(result![1].style.widths).toEqual([6]);
  });
});

describe('eraseFromLayer', () => {
  it('removes a fully-erased object and keeps an untouched one unchanged', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    const objects = getObjectsArray(layer);

    objects.push([
      createVectorObject(makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }])),
      createVectorObject(makeStroke([{ x: 500, y: 500 }, { x: 510, y: 500 }])),
    ]);

    eraseFromLayer(layer, [{ x: 0, y: 0 }, { x: 10, y: 0 }], 5);

    expect(objects.length).toBe(1);
    expect(vectorObjectToData(objects.get(0)).points[0].x).toBe(500);
  });

  it('splitting a stroke replaces one object with two in the layer', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    const objects = getObjectsArray(layer);
    objects.push([createVectorObject(makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }]))]);

    eraseFromLayer(layer, [{ x: 20, y: 0 }], 3);

    expect(objects.length).toBe(2);
  });

  it('does not touch objects in a different layer', () => {
    const doc = createDocument();
    const frame = getFramesArray(doc).get(0);
    const layer1 = getLayersArray(frame).get(0);
    const layer2 = addLayer(frame, 'Layer 2');
    getObjectsArray(layer1).push([createVectorObject(makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]))]);
    getObjectsArray(layer2).push([createVectorObject(makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]))]);

    eraseFromLayer(layer1, [{ x: 0, y: 0 }, { x: 10, y: 0 }], 5);

    expect(getObjectsArray(layer1).length).toBe(0);
    expect(getObjectsArray(layer2).length).toBe(1);
  });
});
