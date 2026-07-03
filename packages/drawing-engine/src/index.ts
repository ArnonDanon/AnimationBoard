export const DRAWING_ENGINE_VERSION = "0.0.0";

export function createEngine() {
  return {
    ping: () => "drawing-engine: pong",
  };
}
