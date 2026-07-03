import * as Y from 'yjs';
import { getFramesArray } from './document';

export function createUndoManager(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager(getFramesArray(doc));
}
