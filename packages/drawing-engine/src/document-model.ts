// Node-safe entry point: the document model and snapshot serialization only, with no
// dependency on Canvas2D/DOM types (unlike the main index.ts, which also re-exports the
// browser-only DrawingEngine/render/input code). Server-side consumers (e.g. the HTTP
// Lambda seeding a new project's initial snapshot) should import from here rather than
// the package root, so their own (Node-only) type-checking never needs to resolve
// browser lib types it will never actually use.
export { createDocument, createDocumentFromSnapshot } from './document.js';
export { exportSnapshot, loadSnapshot, toPlainJSON } from './serialize.js';
