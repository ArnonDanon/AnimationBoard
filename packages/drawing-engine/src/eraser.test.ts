import { describe, expect, it } from 'vitest';
import { eraseFromLayer, eraseFromObjectData } from './eraser';
import { addLayer, createDocument, createVectorObject, getFramesArray, getLayersArray, getObjectsArray, vectorObjectToData } from './document';
import { DEFAULT_TRANSFORM } from './types';
import type { VectorObjectData } from './types';

function makeStroke(points: { x: number; y: number }[], width = 0): VectorObjectData {
  return {
    id: 'stroke-1',
    kind: 'stroke',
    points: points.map((p) => ({ ...p, pressure: 1 })),
    style: { color: '#000', width, opacity: 1 },
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

  it('erases a stroke even when the eraser passes through the middle of a segment, nowhere near any sample point', () => {
    // This is the bug: two points far apart (as a fast/coarse pointer drag produces),
    // with the eraser sitting right on top of the rendered line between them. A
    // point-only distance check would miss this (both points are 50px away); the
    // fix tests the segment itself.
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 50, y: 0 }], 5);
    expect(result).toEqual([]);
  });

  it('widens the hit test by the stroke half-width, so a thick stroke erases even when the eraser center is off its centerline', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 1000, y: 0 }], 20); // half-width 10
    const missesWithoutPadding = eraseFromObjectData(
      makeStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 1000, y: 0 }], 0),
      [{ x: 50, y: 8 }],
      2,
    );
    expect(missesWithoutPadding).toBeNull(); // 8px off centerline, radius 2, hairline stroke: genuinely misses

    const hitsWithPadding = eraseFromObjectData(stroke, [{ x: 50, y: 8 }], 2);
    expect(hitsWithPadding).toHaveLength(1);
    expect(hitsWithPadding![0].points[0].x).toBe(1000); // the untouched far point survives
  });

  it('splits a stroke into two fragments when the eraser cuts through one segment in the middle', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 125, y: 0 }], 4);
    expect(result).toHaveLength(2);
    expect(result![0].points.map((p) => p.x)).toEqual([0, 50]);
    expect(result![1].points.map((p) => p.x)).toEqual([200]);
  });

  it('trims the tail when the eraser only touches the last segment', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 140, y: 0 }], 4);
    expect(result).toHaveLength(1);
    expect(result![0].points.map((p) => p.x)).toEqual([0, 50]);
  });

  it('bakes the object transform into surviving fragment points and resets to identity', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 1000, y: 0 }]);
    stroke.transform = { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0 };

    const missed = eraseFromObjectData(stroke, [{ x: 9999, y: 9999 }], 3);
    expect(missed).toBeNull();

    const hit = eraseFromObjectData(stroke, [{ x: 100, y: 50 }], 3);
    expect(hit).toHaveLength(1);
    expect(hit![0].transform).toEqual(DEFAULT_TRANSFORM);
    expect(hit![0].points[0].x).toBe(1100); // 1000 (local) + 100 (translate) — the surviving far point
  });

  it('slices per-point widths so a pressure-sensitive stroke keeps its correct widths after a split', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }]);
    stroke.style.widths = [2, 4, 6, 8, 10];
    const result = eraseFromObjectData(stroke, [{ x: 125, y: 0 }], 2);
    expect(result).toHaveLength(2);
    expect(result![0].style.widths).toEqual([2, 4]);
    expect(result![1].style.widths).toEqual([10]);
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
    objects.push([
      createVectorObject(makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }])),
    ]);

    eraseFromLayer(layer, [{ x: 125, y: 0 }], 4);

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
