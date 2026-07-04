import * as Y from 'yjs';

// Browser-only base64 <-> bytes helpers (no Buffer global here), mirroring
// apps/web/src/api/base64.ts so both sides of the transport agree on encoding.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 15000;

export interface RealtimeProviderOptions {
  doc: Y.Doc;
  url: string;
  /**
   * Called when the server reports this connection's access was revoked (an owner
   * removed this animator from the project). The provider stops reconnecting after
   * this fires — reconnecting would just fail the $connect authorizer's now-missing
   * membership check anyway.
   */
  onRevoked?: () => void;
}

/**
 * Relays a Y.Doc's incremental updates over a WebSocket to the serverless relay
 * (ADR-006). The relay never merges CRDT state, so this provider does not do
 * y-websocket's sync-step handshake — clients already hydrate from the full HTTP
 * snapshot (Epic 9) before connecting, and this only carries edits from that point on.
 *
 * Uses the transaction-origin mechanism (not manual bookkeeping) to avoid echo loops
 * and undo-stack pollution: local edits have origin `null` and get sent; inbound
 * updates are applied with `this` as origin, so this provider's own update listener
 * skips re-sending them, and Y.UndoManager (which only tracks origin `null` by
 * default) never records a remote peer's edit as locally undoable.
 */
export class RealtimeProvider {
  private readonly doc: Y.Doc;
  private readonly url: string;
  private readonly onRevoked?: () => void;
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private reconnectHandle: ReturnType<typeof setTimeout> | null = null;
  // Edits made while the socket is still connecting (initial handshake, e.g. Lambda
  // authorizer cold start, or mid-reconnect after a drop) would otherwise be silently
  // dropped from the realtime channel instead of just delayed — queue and flush on open.
  private pendingMessages: string[] = [];

  constructor(options: RealtimeProviderOptions) {
    this.doc = options.doc;
    this.url = options.url;
    this.onRevoked = options.onRevoked;
    this.doc.on('update', this.handleLocalUpdate);
    this.connect();
  }

  private handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return; // just applied a remote update — don't echo it back
    const message = JSON.stringify({ type: 'update', update: bytesToBase64(update) });
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.pendingMessages.push(message);
    }
  };

  private connect(): void {
    const ws = new WebSocket(this.url);
    ws.onopen = () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      const queued = this.pendingMessages;
      this.pendingMessages = [];
      for (const message of queued) ws.send(message);
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as { type: string; update?: string };
        if (message.type === 'update' && message.update) {
          Y.applyUpdate(this.doc, base64ToBytes(message.update), this);
        } else if (message.type === 'revoked') {
          this.onRevoked?.();
          this.destroy();
        }
      } catch (err) {
        console.error('realtime: failed to apply remote update', err);
      }
    };
    ws.onclose = () => {
      if (!this.closed) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
    this.ws = ws;
  }

  private scheduleReconnect(): void {
    this.reconnectHandle = setTimeout(() => {
      if (!this.closed) this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }

  destroy(): void {
    this.closed = true;
    if (this.reconnectHandle) clearTimeout(this.reconnectHandle);
    this.doc.off('update', this.handleLocalUpdate);
    this.ws?.close();
    this.ws = null;
  }
}

export function createRealtimeProvider(options: RealtimeProviderOptions): RealtimeProvider {
  return new RealtimeProvider(options);
}
