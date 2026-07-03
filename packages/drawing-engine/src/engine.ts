import * as Y from 'yjs';
import {
  addFrame as addFrameToDoc,
  addLayer as addLayerToDoc,
  createDocument,
  createVectorObject,
  deleteLayer as deleteLayerFromDoc,
  duplicateLayer as duplicateLayerInDoc,
  getFramesArray,
  getLayersArray,
  getObjectsArray,
  isLayerEditable,
  layerToData,
  moveLayer as moveLayerInDoc,
  renameLayer as renameLayerInDoc,
  setLayerLocked as setLayerLockedInDoc,
  setLayerVisible as setLayerVisibleInDoc,
  vectorObjectToData,
} from './document';
import type { YFrame, YObject } from './document';
import { attachPointerCapture } from './input';
import { hitTestFrame } from './geometry';
import { paintEraserCursor, paintSelectionOutline, paintStroke, renderFrame } from './render';
import { createUndoManager } from './history';
import { exportSnapshot as encodeSnapshot } from './serialize';
import { rotateObject, scaleObject, translateObject } from './transform';
import { DEFAULT_BRUSH, resolveStrokeStyle } from './brush';
import { BUILT_IN_PALETTE } from './palette';
import { eraseFromLayer } from './eraser';
import { DEFAULT_TRANSFORM } from './types';
import type { Brush, LayerData, Point, Tool } from './types';

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  animatorId?: string;
  doc?: Y.Doc;
}

const DEFAULT_ERASER_RADIUS = 12;

export class DrawingEngine {
  readonly doc: Y.Doc;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly undoManager: Y.UndoManager;
  private readonly detachInput: () => void;
  private readonly animatorId: string;
  private readonly listeners = new Set<() => void>();

  private activeFrameIndex = 0;
  private activeLayerIndex = 0;
  private drawingPoints: Point[] | null = null;
  private selectedObjectId: string | null = null;
  private dragOrigin: Point | null = null;
  private activeBrush: Brush = DEFAULT_BRUSH;
  private activeColor: string = BUILT_IN_PALETTE[0];
  private activeTool: Tool = 'brush';
  private eraserRadius = DEFAULT_ERASER_RADIUS;
  private lastErasePoint: Point | null = null;
  private hoverPoint: Point | null = null;

  constructor(options: EngineOptions) {
    this.doc = options.doc ?? createDocument();
    this.animatorId = options.animatorId ?? 'local';
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.undoManager = createUndoManager(this.doc);

    this.doc.on('update', () => this.notify());
    this.detachInput = attachPointerCapture(this.canvas, {
      onStart: (p) => this.handlePointerStart(p),
      onMove: (p) => this.handlePointerMove(p),
      onEnd: (p) => this.handlePointerEnd(p),
      onHover: (p) => this.handleHover(p),
      onHoverEnd: () => this.handleHoverEnd(),
    });

    this.render();
  }

  private get activeFrame(): YFrame {
    const frames = getFramesArray(this.doc);
    return frames.get(Math.min(this.activeFrameIndex, frames.length - 1));
  }

  private get activeLayer() {
    const layers = getLayersArray(this.activeFrame);
    return layers.get(Math.min(this.activeLayerIndex, layers.length - 1));
  }

  private handlePointerStart(p: Point): void {
    if (this.activeTool === 'eraser') {
      this.lastErasePoint = p;
      this.eraseAt([p]);
      return;
    }

    if (this.activeTool === 'select') {
      const hit = hitTestFrame(this.ctx, this.activeFrame, p.x, p.y);
      this.selectedObjectId = hit ? vectorObjectToData(hit).id : null;
      this.dragOrigin = hit ? p : null;
      this.notify();
      return;
    }

    // Brush tool always starts a new stroke — it never hit-tests existing objects.
    // (It used to, which meant starting a stroke close to an existing one would
    // silently select-and-drag that object instead of drawing, corrupting a dense
    // scribble one stroke at a time. Selecting/moving is now Select tool's job only.)
    const layer = this.activeLayer;
    if (!layer || !isLayerEditable(layer)) {
      this.notify();
      return;
    }
    this.drawingPoints = [p];
    this.notify();
  }

  private handlePointerMove(p: Point): void {
    if (this.activeTool === 'eraser') {
      if (this.lastErasePoint) {
        this.eraseAt([this.lastErasePoint, p]);
        this.lastErasePoint = p;
      }
      return;
    }

    if (this.drawingPoints) {
      this.drawingPoints.push(p);
      this.renderWithLiveStroke();
      return;
    }
    if (this.selectedObjectId && this.dragOrigin) {
      const dx = p.x - this.dragOrigin.x;
      const dy = p.y - this.dragOrigin.y;
      this.dragOrigin = p;
      const obj = this.findObjectById(this.selectedObjectId);
      if (obj) translateObject(obj, dx, dy);
    }
  }

  private handlePointerEnd(p: Point): void {
    if (this.activeTool === 'eraser') {
      this.lastErasePoint = null;
      return;
    }

    if (this.drawingPoints) {
      this.drawingPoints.push(p);
      this.commitStroke(this.drawingPoints);
      this.drawingPoints = null;
    }
    this.dragOrigin = null;
  }

  private eraseAt(path: Point[]): void {
    const layer = this.activeLayer;
    if (!layer || !isLayerEditable(layer)) return;
    eraseFromLayer(layer, path, this.eraserRadius);
  }

  private handleHover(p: Point): void {
    this.hoverPoint = p;
    // A full notify() would re-fire every UI listener on every mouse pixel of
    // movement; a direct render() keeps the cursor smooth without that overhead.
    if (this.activeTool === 'eraser') this.render();
  }

  private handleHoverEnd(): void {
    this.hoverPoint = null;
    if (this.activeTool === 'eraser') this.render();
  }

  private commitStroke(points: Point[]): void {
    const layer = this.activeLayer;
    if (!layer || !isLayerEditable(layer)) return;
    const obj = createVectorObject({
      kind: 'stroke',
      points,
      style: resolveStrokeStyle(this.activeBrush, points, this.activeColor),
      transform: { ...DEFAULT_TRANSFORM },
      createdBy: this.animatorId,
    });
    getObjectsArray(layer).push([obj]);
  }

  private findObjectById(id: string): YObject | null {
    const layers = getLayersArray(this.activeFrame);
    for (let i = 0; i < layers.length; i++) {
      const objects = getObjectsArray(layers.get(i));
      for (let j = 0; j < objects.length; j++) {
        if (vectorObjectToData(objects.get(j)).id === id) return objects.get(j);
      }
    }
    return null;
  }

  private render(): void {
    renderFrame(this.ctx, this.canvas, this.activeFrame);
    if (this.selectedObjectId) {
      const obj = this.findObjectById(this.selectedObjectId);
      if (obj) {
        const data = vectorObjectToData(obj);
        paintSelectionOutline(this.ctx, data.points, data.transform);
      }
    }
    if (this.activeTool === 'eraser' && this.hoverPoint) {
      paintEraserCursor(this.ctx, this.hoverPoint, this.eraserRadius);
    }
  }

  private renderWithLiveStroke(): void {
    renderFrame(this.ctx, this.canvas, this.activeFrame);
    if (this.drawingPoints) {
      const style = resolveStrokeStyle(this.activeBrush, this.drawingPoints, this.activeColor);
      paintStroke(this.ctx, this.drawingPoints, style, DEFAULT_TRANSFORM);
    }
  }

  private notify(): void {
    this.render();
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getFrameCount(): number {
    return getFramesArray(this.doc).length;
  }

  getActiveFrameIndex(): number {
    return this.activeFrameIndex;
  }

  setActiveFrameIndex(index: number): void {
    const count = this.getFrameCount();
    this.activeFrameIndex = Math.max(0, Math.min(index, count - 1));
    this.selectedObjectId = null;
    this.notify();
  }

  hasSelection(): boolean {
    return this.selectedObjectId !== null;
  }

  getActiveBrush(): Brush {
    return this.activeBrush;
  }

  setActiveBrush(brush: Brush): void {
    this.activeBrush = brush;
    this.notify();
  }

  getActiveColor(): string {
    return this.activeColor;
  }

  setActiveColor(color: string): void {
    this.activeColor = color;
    this.notify();
  }

  getActiveTool(): Tool {
    return this.activeTool;
  }

  setActiveTool(tool: Tool): void {
    this.activeTool = tool;
    this.selectedObjectId = null;
    this.notify();
  }

  getEraserRadius(): number {
    return this.eraserRadius;
  }

  setEraserRadius(radius: number): void {
    this.eraserRadius = radius;
    this.notify();
  }

  addFrame(name?: string): void {
    addFrameToDoc(this.doc, name);
    this.setActiveFrameIndex(this.getFrameCount() - 1);
  }

  getLayers(): LayerData[] {
    const layers = getLayersArray(this.activeFrame);
    const result: LayerData[] = [];
    for (let i = 0; i < layers.length; i++) result.push(layerToData(layers.get(i)));
    return result;
  }

  getActiveLayerIndex(): number {
    return Math.min(this.activeLayerIndex, getLayersArray(this.activeFrame).length - 1);
  }

  setActiveLayerIndex(index: number): void {
    const count = getLayersArray(this.activeFrame).length;
    this.activeLayerIndex = Math.max(0, Math.min(index, count - 1));
    this.notify();
  }

  addLayer(name?: string): void {
    addLayerToDoc(this.activeFrame, name);
    // A newly added layer becomes active, ready to draw on immediately.
    this.activeLayerIndex = getLayersArray(this.activeFrame).length - 1;
    this.notify();
  }

  deleteLayer(index: number): void {
    const removed = deleteLayerFromDoc(this.activeFrame, index);
    if (!removed) return; // refused: it was the frame's last layer
    this.activeLayerIndex = Math.min(this.activeLayerIndex, getLayersArray(this.activeFrame).length - 1);
    // The selected object may have lived on the deleted layer.
    if (this.selectedObjectId && !this.findObjectById(this.selectedObjectId)) {
      this.selectedObjectId = null;
    }
    this.notify();
  }

  duplicateLayer(index: number): void {
    duplicateLayerInDoc(this.activeFrame, index);
    this.activeLayerIndex = index + 1; // the new copy, inserted directly above, becomes active
    this.notify();
  }

  renameLayer(index: number, name: string): void {
    const layers = getLayersArray(this.activeFrame);
    renameLayerInDoc(layers.get(index), name);
  }

  setLayerVisible(index: number, visible: boolean): void {
    const layers = getLayersArray(this.activeFrame);
    setLayerVisibleInDoc(layers.get(index), visible);
  }

  setLayerLocked(index: number, locked: boolean): void {
    const layers = getLayersArray(this.activeFrame);
    setLayerLockedInDoc(layers.get(index), locked);
  }

  moveLayerUp(index: number): void {
    const newIndex = moveLayerInDoc(this.activeFrame, index, index + 1);
    if (this.activeLayerIndex === index) this.activeLayerIndex = newIndex;
    this.notify();
  }

  moveLayerDown(index: number): void {
    const newIndex = moveLayerInDoc(this.activeFrame, index, index - 1);
    if (this.activeLayerIndex === index) this.activeLayerIndex = newIndex;
    this.notify();
  }

  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  scaleSelection(factor: number): void {
    if (!this.selectedObjectId) return;
    const obj = this.findObjectById(this.selectedObjectId);
    if (obj) scaleObject(obj, factor);
  }

  rotateSelection(degrees: number): void {
    if (!this.selectedObjectId) return;
    const obj = this.findObjectById(this.selectedObjectId);
    if (obj) rotateObject(obj, degrees);
  }

  exportSnapshot(): Uint8Array {
    return encodeSnapshot(this.doc);
  }

  destroy(): void {
    this.detachInput();
    this.listeners.clear();
  }
}

export function createEngine(options: EngineOptions): DrawingEngine {
  return new DrawingEngine(options);
}
