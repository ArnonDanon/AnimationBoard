import * as Y from 'yjs';
import {
  addFrame as addFrameToDoc,
  addLayer as addLayerToDoc,
  createDocument,
  createVectorObject,
  deleteFrame as deleteFrameFromDoc,
  deleteLayer as deleteLayerFromDoc,
  duplicateFrame as duplicateFrameInDoc,
  duplicateLayer as duplicateLayerInDoc,
  frameToData,
  getFps as getFpsFromDoc,
  getFramesArray,
  getLayersArray,
  getObjectsArray,
  isLayerEditable,
  layerToData,
  moveFrame as moveFrameInDoc,
  moveLayer as moveLayerInDoc,
  renameFrame as renameFrameInDoc,
  renameLayer as renameLayerInDoc,
  setFps as setFpsInDoc,
  setLayerLocked as setLayerLockedInDoc,
  setLayerVisible as setLayerVisibleInDoc,
  vectorObjectToData,
} from './document';
import type { YFrame, YObject } from './document';
import { attachPointerCapture } from './input';
import type { PointerModifiers } from './input';
import { getObjectBoundsPoints, hitTestFrame } from './geometry';
import { paintEraserCursor, paintEllipse, paintFrameLayers, paintRect, paintSelectionOutline, paintStroke, renderFrame, renderOnionSkin } from './render';
import { createUndoManager } from './history';
import { exportSnapshot as encodeSnapshot } from './serialize';
import { rotateObject, scaleObject, translateObject } from './transform';
import { DEFAULT_BRUSH, resolveStrokeStyle } from './brush';
import { BUILT_IN_PALETTE } from './palette';
import { rgbToHex } from './color';
import { eraseFromLayer } from './eraser';
import { DEFAULT_TRANSFORM } from './types';
import type { Brush, FrameData, LayerData, Point, Tool } from './types';

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  animatorId?: string;
  doc?: Y.Doc;
}

const DEFAULT_ERASER_RADIUS = 12;
// Fixed for this first version — no adjustment UI yet (see backlog).
const ONION_SKIN_OPACITY = 0.25;

// Holding Shift while dragging a shape constrains it to a square/circle — the
// standard Illustrator/Figma/Photoshop convention. Recomputed fresh from the raw
// pointer position on every move/end event (rather than latched once at drag start),
// so releasing or pressing Shift mid-drag takes effect immediately, matching what
// those tools do.
function constrainToSquare(origin: Point, current: Point, shiftKey: boolean): Point {
  if (!shiftKey) return current;
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: origin.x + Math.sign(dx || 1) * side,
    y: origin.y + Math.sign(dy || 1) * side,
    pressure: current.pressure,
  };
}

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
  // Rectangle/ellipse drag state — a start point + the latest (possibly
  // shift-constrained) point, not a growing array like `drawingPoints`, since a shape
  // only ever needs its 2 bounding-box corners.
  private shapeOrigin: Point | null = null;
  private shapeCurrent: Point | null = null;
  private selectedObjectId: string | null = null;
  private dragOrigin: Point | null = null;
  private activeBrush: Brush = DEFAULT_BRUSH;
  // Per-brush size/opacity tweaks, remembered for the lifetime of this engine
  // instance (not persisted to the document — it's a personal tool preference,
  // not project content) so switching brushes back and forth keeps each one's
  // last-used settings instead of resetting to its preset defaults.
  private readonly brushOverrides = new Map<string, { baseWidth: number; opacity: number }>();
  private activeColor: string = BUILT_IN_PALETTE[0];
  private activeTool: Tool = 'brush';
  private eraserRadius = DEFAULT_ERASER_RADIUS;
  private lastErasePoint: Point | null = null;
  private hoverPoint: Point | null = null;
  private playbackTimer: ReturnType<typeof setInterval> | null = null;
  private playbackStartFrameIndex: number | null = null;
  // Personal viewing preference, not project content — not persisted, same category
  // as brush size/opacity overrides above.
  private onionSkinEnabled = false;

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
      onStart: (p, m) => this.handlePointerStart(p, m),
      onMove: (p, m) => this.handlePointerMove(p, m),
      onEnd: (p, m) => this.handlePointerEnd(p, m),
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

  private handlePointerStart(p: Point, modifiers: PointerModifiers): void {
    if (this.activeTool === 'colorPicker') {
      this.sampleColorAt(p);
      return;
    }

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

    if (this.activeTool === 'rectangle' || this.activeTool === 'ellipse') {
      const layer = this.activeLayer;
      if (!layer || !isLayerEditable(layer)) {
        this.notify();
        return;
      }
      this.shapeOrigin = p;
      this.shapeCurrent = constrainToSquare(p, p, modifiers.shiftKey);
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

  private handlePointerMove(p: Point, modifiers: PointerModifiers): void {
    if (this.activeTool === 'eraser') {
      if (this.lastErasePoint) {
        this.eraseAt([this.lastErasePoint, p]);
        this.lastErasePoint = p;
      }
      return;
    }

    if (this.shapeOrigin) {
      this.shapeCurrent = constrainToSquare(this.shapeOrigin, p, modifiers.shiftKey);
      this.renderWithLiveShape();
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

  private handlePointerEnd(p: Point, modifiers: PointerModifiers): void {
    if (this.activeTool === 'eraser') {
      this.lastErasePoint = null;
      return;
    }

    if (this.shapeOrigin) {
      const end = constrainToSquare(this.shapeOrigin, p, modifiers.shiftKey);
      this.commitShape(this.activeTool as 'rectangle' | 'ellipse', [this.shapeOrigin, end]);
      this.shapeOrigin = null;
      this.shapeCurrent = null;
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

  // Reads the already-rendered canvas pixel directly rather than hit-testing objects —
  // this automatically respects layer visibility, stacking order, and opacity blending
  // for free, since the canvas is already the fully composited result.
  private sampleColorAt(p: Point): void {
    const pixel = this.ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
    if (pixel[3] === 0) return; // nothing drawn here — leave the active color as-is
    this.setActiveColor(rgbToHex(pixel[0], pixel[1], pixel[2]));
    this.setActiveTool('brush'); // pick, then continue drawing immediately
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

  // No pressure-sensitivity or outline mode for shapes in this basic version — solid
  // fill at the active color, full opacity, mirroring how a brush stroke is solid ink.
  private commitShape(kind: 'rectangle' | 'ellipse', points: Point[]): void {
    const layer = this.activeLayer;
    if (!layer || !isLayerEditable(layer)) return;
    const obj = createVectorObject({
      kind,
      points,
      style: { color: this.activeColor, width: 1, opacity: 1 },
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

  private getPreviousFrame(): YFrame | null {
    const frames = getFramesArray(this.doc);
    return this.activeFrameIndex > 0 ? frames.get(this.activeFrameIndex - 1) : null;
  }

  // Clears and paints the current frame's real content, with the dimmed previous
  // frame underneath when onion skin is on — shared by render() and the two
  // live-preview variants so the onion overlay never disappears mid-drag.
  // Suppressed during playback (checked fresh each call, not a separate saved/restored
  // flag) so the animation preview shows only real frame content — the toggle itself
  // is untouched, so onion resumes automatically the moment playback stops.
  private paintBase(): void {
    if (!this.onionSkinEnabled || this.getIsPlaying()) {
      renderFrame(this.ctx, this.canvas, this.activeFrame);
      return;
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const previous = this.getPreviousFrame();
    if (previous) renderOnionSkin(this.ctx, this.canvas, previous, ONION_SKIN_OPACITY);
    paintFrameLayers(this.ctx, this.activeFrame);
  }

  private render(): void {
    this.paintBase();
    if (this.selectedObjectId) {
      const obj = this.findObjectById(this.selectedObjectId);
      if (obj) {
        const data = vectorObjectToData(obj);
        paintSelectionOutline(this.ctx, getObjectBoundsPoints(data), data.transform);
      }
    }
    if (this.activeTool === 'eraser' && this.hoverPoint) {
      paintEraserCursor(this.ctx, this.hoverPoint, this.eraserRadius);
    }
  }

  private renderWithLiveStroke(): void {
    this.paintBase();
    if (this.drawingPoints) {
      const style = resolveStrokeStyle(this.activeBrush, this.drawingPoints, this.activeColor);
      paintStroke(this.ctx, this.drawingPoints, style, DEFAULT_TRANSFORM);
    }
  }

  private renderWithLiveShape(): void {
    this.paintBase();
    if (this.shapeOrigin && this.shapeCurrent) {
      const style = { color: this.activeColor, width: 1, opacity: 1 };
      const points = [this.shapeOrigin, this.shapeCurrent];
      if (this.activeTool === 'rectangle') paintRect(this.ctx, points, style, DEFAULT_TRANSFORM);
      else paintEllipse(this.ctx, points, style, DEFAULT_TRANSFORM);
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

  private setFrameIndexRaw(index: number): void {
    const count = this.getFrameCount();
    this.activeFrameIndex = Math.max(0, Math.min(index, count - 1));
    this.selectedObjectId = null;
  }

  setActiveFrameIndex(index: number): void {
    this.pause(); // manual navigation while playing would fight with the playback timer
    this.setFrameIndexRaw(index);
    this.notify();
  }

  hasSelection(): boolean {
    return this.selectedObjectId !== null;
  }

  getActiveBrush(): Brush {
    return this.activeBrush;
  }

  setActiveBrush(brush: Brush): void {
    // Reapply this brush's own remembered size/opacity tweak, if the user has
    // adjusted it before this session — otherwise fall back to the preset's default.
    const override = this.brushOverrides.get(brush.id);
    this.activeBrush = override ? { ...brush, ...override } : { ...brush };
    this.notify();
  }

  setBrushSize(size: number): void {
    const baseWidth = Math.max(1, size);
    this.activeBrush = { ...this.activeBrush, baseWidth };
    this.brushOverrides.set(this.activeBrush.id, { baseWidth, opacity: this.activeBrush.opacity });
    this.notify();
  }

  setBrushOpacity(opacity: number): void {
    const clampedOpacity = Math.max(0.05, Math.min(1, opacity));
    this.activeBrush = { ...this.activeBrush, opacity: clampedOpacity };
    this.brushOverrides.set(this.activeBrush.id, { baseWidth: this.activeBrush.baseWidth, opacity: clampedOpacity });
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
    this.shapeOrigin = null;
    this.shapeCurrent = null;
    this.notify();
  }

  getEraserRadius(): number {
    return this.eraserRadius;
  }

  setEraserRadius(radius: number): void {
    this.eraserRadius = radius;
    this.notify();
  }

  getOnionSkinEnabled(): boolean {
    return this.onionSkinEnabled;
  }

  setOnionSkinEnabled(enabled: boolean): void {
    this.onionSkinEnabled = enabled;
    this.notify();
  }

  addFrame(name?: string): void {
    addFrameToDoc(this.doc, name);
    this.setActiveFrameIndex(this.getFrameCount() - 1);
  }

  getFrames(): FrameData[] {
    const frames = getFramesArray(this.doc);
    const result: FrameData[] = [];
    for (let i = 0; i < frames.length; i++) result.push(frameToData(frames.get(i)));
    return result;
  }

  getFps(): number {
    return getFpsFromDoc(this.doc);
  }

  setFps(fps: number): void {
    setFpsInDoc(this.doc, fps);
    if (this.getIsPlaying()) {
      // Restart the timer at the new interval rather than waiting for the old one to fire.
      this.pause();
      this.play();
    }
  }

  deleteFrame(index: number): void {
    const removed = deleteFrameFromDoc(this.doc, index);
    if (!removed) return; // refused: it was the timeline's last frame
    this.pause();
    this.setFrameIndexRaw(Math.min(this.activeFrameIndex, this.getFrameCount() - 1));
    this.notify();
  }

  duplicateFrame(index: number): void {
    duplicateFrameInDoc(this.doc, index);
    this.setActiveFrameIndex(index + 1); // the new copy, inserted directly after, becomes active
  }

  renameFrame(index: number, name: string): void {
    const frames = getFramesArray(this.doc);
    renameFrameInDoc(frames.get(index), name);
  }

  moveFrameEarlier(index: number): void {
    this.pause();
    const newIndex = moveFrameInDoc(this.doc, index, index - 1);
    if (this.activeFrameIndex === index) this.activeFrameIndex = newIndex;
    this.notify();
  }

  moveFrameLater(index: number): void {
    this.pause();
    const newIndex = moveFrameInDoc(this.doc, index, index + 1);
    if (this.activeFrameIndex === index) this.activeFrameIndex = newIndex;
    this.notify();
  }

  getIsPlaying(): boolean {
    return this.playbackTimer !== null;
  }

  play(): void {
    if (this.playbackTimer || this.getFrameCount() <= 1) return;
    if (this.activeFrameIndex >= this.getFrameCount() - 1) this.setFrameIndexRaw(0);
    // Remembered so playback reaching the natural end can return here — but only
    // the natural end does this; a manual pause() mid-playback leaves the
    // playhead where the user stopped it (see pause()).
    this.playbackStartFrameIndex = this.activeFrameIndex;
    const intervalMs = 1000 / this.getFps();
    this.playbackTimer = setInterval(() => {
      const next = this.activeFrameIndex + 1;
      if (next >= this.getFrameCount()) {
        // Not this.pause(): that would notify once with the last frame still
        // active, before also snapping back — inlined here so there's exactly one
        // notify(), already showing the returned-to frame.
        clearInterval(this.playbackTimer!);
        this.playbackTimer = null;
        if (this.playbackStartFrameIndex !== null) {
          this.setFrameIndexRaw(this.playbackStartFrameIndex);
        }
        this.playbackStartFrameIndex = null;
        this.notify();
        return;
      }
      this.setFrameIndexRaw(next);
      this.notify();
    }, intervalMs);
    this.notify();
  }

  pause(): void {
    if (!this.playbackTimer) return;
    clearInterval(this.playbackTimer);
    this.playbackTimer = null;
    this.notify();
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
    if (!removed) return; // refused: it was the frame's last layer, or the layer is locked
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
    if (this.playbackTimer) clearInterval(this.playbackTimer);
    this.detachInput();
    this.listeners.clear();
  }
}

export function createEngine(options: EngineOptions): DrawingEngine {
  return new DrawingEngine(options);
}
