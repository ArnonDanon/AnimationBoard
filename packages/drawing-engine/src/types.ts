export interface Point {
  x: number;
  y: number;
  pressure: number;
}

export interface Style {
  color: string;
  width: number;
  opacity: number;
}

export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface VectorObjectData {
  id: string;
  kind: 'stroke';
  points: Point[];
  style: Style;
  transform: Transform;
  createdBy: string;
}

export interface LayerData {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface FrameData {
  id: string;
  name: string;
}

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
