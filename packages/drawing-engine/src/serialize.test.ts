import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { addFrame, createDocumentFromSnapshot, createVectorObject, getFramesArray, getLayersArray, getObjectsArray } from './document';
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
