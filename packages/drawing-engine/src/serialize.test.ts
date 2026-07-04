import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { addFrame, createDocumentFromSnapshot, createVectorObject, getFramesArray, getLayersArray, getObjectsArray, vectorObjectToData } from './document';
import { createDocument } from './document';
import { exportSnapshot, loadSnapshot, toPlainJSON } from './serialize';
import { DEFAULT_TRANSFORM } from './types';

describe('exportSnapshot / createDocumentFromSnapshot', () => {
  it('restores an equivalent document from a binary snapshot', () => {
    const doc = createDocument();
    addFrame(doc, 'Frame 2');
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    getObjectsArray(layer).push([
      createVectorObject({
        kind: 'stroke',
        points: [{ x: 1, y: 2, pressure: 1 }],
        style: { color: '#ff0000', width: 2, opacity: 1 },
        transform: { ...DEFAULT_TRANSFORM },
        createdBy: 'animator-1',
      }),
    ]);

    const snapshot = exportSnapshot(doc);
    const restored = createDocumentFromSnapshot(snapshot);

    expect(toPlainJSON(restored)).toEqual(toPlainJSON(doc));
  });

  it('round-trips a non-stroke kind (rectangle/ellipse) with the widened VectorObjectData.kind type', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    getObjectsArray(layer).push([
      createVectorObject({
        kind: 'rectangle',
        points: [{ x: 0, y: 0, pressure: 1 }, { x: 50, y: 30, pressure: 1 }],
        style: { color: '#00ff00', width: 1, opacity: 1 },
        transform: { ...DEFAULT_TRANSFORM },
        createdBy: 'animator-1',
      }),
      createVectorObject({
        kind: 'ellipse',
        points: [{ x: 10, y: 10, pressure: 1 }, { x: 60, y: 40, pressure: 1 }],
        style: { color: '#0000ff', width: 1, opacity: 1 },
        transform: { ...DEFAULT_TRANSFORM },
        createdBy: 'animator-1',
      }),
    ]);

    const restored = createDocumentFromSnapshot(exportSnapshot(doc));
    const restoredLayer = getLayersArray(getFramesArray(restored).get(0)).get(0);
    const restoredObjects = getObjectsArray(restoredLayer);

    expect(vectorObjectToData(restoredObjects.get(0)).kind).toBe('rectangle');
    expect(vectorObjectToData(restoredObjects.get(1)).kind).toBe('ellipse');
    expect(toPlainJSON(restored)).toEqual(toPlainJSON(doc));
  });
});

describe('loadSnapshot', () => {
  it('merges a snapshot into an existing doc', () => {
    const source = createDocument();
    addFrame(source, 'Frame 2');

    const target = new Y.Doc();
    loadSnapshot(target, exportSnapshot(source));

    expect(toPlainJSON(target)).toEqual(toPlainJSON(source));
  });
});
