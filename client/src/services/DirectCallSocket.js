import { resolveDirectCallWebSocketUrl } from '../lib/directCallAuth.js';

export class DirectCallSocket {
  constructor({ callbacks = {}, token }) {
    this.callbacks = callbacks;
    this.explicitlyClosed = false;
    this.reconnectTimer = 0;
    this.token = token;
    this.ws = null;
  }

  connect() {
    if (this.ws && this.ws.readyState <= 1) {
      return;
    }

    this.explicitlyClosed = false;
    this.callbacks.onConnectionStateChange?.('connecting');

    const ws = new WebSocket(resolveDirectCallWebSocketUrl());
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.callbacks.onConnectionStateChange?.('authenticating');
      try {
        console.log('[direct-call] websocket open, sending auth');
        this.send('auth', {
          appState: document.visibilityState === 'hidden' ? 'background' : 'foreground',
          token: this.token,
        });
      } catch (error) {
        console.error('[direct-call] auth send failed', error);
        this.callbacks.onError?.(error);
      }
    });

    ws.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload.type === 'auth-success') {
          this.callbacks.onConnectionStateChange?.('online');
        }

        this.callbacks.onEvent?.(payload);
      } catch (error) {
        this.callbacks.onError?.(error);
      }
    });

    ws.addEventListener('close', (event) => {
      console.warn('[direct-call] websocket closed', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      this.ws = null;
      this.callbacks.onClose?.(event);

      if (this.explicitlyClosed) {
        this.callbacks.onConnectionStateChange?.('offline');
        return;
      }

      this.callbacks.onConnectionStateChange?.('reconnecting');
      this.reconnectTimer = window.setTimeout(() => {
        this.connect();
      }, 2_000);
    });

    ws.addEventListener('error', (event) => {
      console.error('[direct-call] websocket error', event);
      this.callbacks.onError?.(event);
    });
  }

  disconnect() {
    this.explicitlyClosed = true;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = 0;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Signal socket is not connected');
    }

    this.ws.send(JSON.stringify({
      type,
      ...payload,
    }));
  }

  updateAppState(appState) {
    try {
      this.send('presence-update', { appState });
    } catch {
      // Ignore visibility pings while reconnecting.
    }
  }
}
