import * as Y from 'yjs';

export function exportSnapshot(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

export function loadSnapshot(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update);
}

export function toPlainJSON(doc: Y.Doc): unknown {
  return {
    meta: doc.getMap('meta').toJSON(),
    frames: doc.getArray('frames').toJSON(),
  };
}
