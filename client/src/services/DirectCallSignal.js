import { get, off, onChildAdded, onDisconnect, onValue, push, ref, remove, runTransaction, serverTimestamp, set, update } from 'firebase/database';
import { assertFirebaseConfigured } from '../lib/firebase.js';

function normalizeCallRecord(callId, value) {
  if (!value) {
    return null;
  }

  return {
    ...value,
    callId,
  };
}

function getPendingCalls(value) {
  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value)
    .map(([callId, entry]) => normalizeCallRecord(callId, entry))
    .filter((entry) => entry && entry.status === 'ringing')
    .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
}

function shallowEqualDescription(left, right) {
  return (
    left?.type === right?.type
    && left?.sdp === right?.sdp
  );
}

function getSignalPath(...segments) {
  return ['directCalls', ...segments].join('/');
}

export class DirectCallSignal {
  constructor({
    callbacks = {},
    ringTimeoutMs = 30_000,
    session,
  }) {
    this.callbacks = callbacks;
    this.db = assertFirebaseConfigured();
    this.explicitlyClosed = false;
    this.incomingValueHandler = null;
    this.pendingCalls = [];
    this.presenceConnectedHandler = null;
    this.presenceInfo = null;
    this.ringTimeoutMs = ringTimeoutMs;
    this.ringTimers = new Map();
    this.session = session;
    this.userId = session?.userId || '';
    this.userDisplayName = session?.displayName || session?.userId || '';
    this.callObservers = new Map();
  }

  connect() {
    if (!this.userId) {
      throw new Error('Authentication is required to start Firebase signaling');
    }

    this.explicitlyClosed = false;
    this.callbacks.onConnectionStateChange?.('connecting');
    this.observePresence();
    this.observeIncomingCalls();
  }

  disconnect() {
    this.explicitlyClosed = true;
    this.callbacks.onConnectionStateChange?.('offline');

    for (const timeoutId of this.ringTimers.values()) {
      window.clearTimeout(timeoutId);
    }

    this.ringTimers.clear();

    for (const observer of this.callObservers.values()) {
      observer.dispose();
    }

    this.callObservers.clear();

    if (this.presenceConnectedHandler) {
      off(this.connectedRef, 'value', this.presenceConnectedHandler);
      this.presenceConnectedHandler = null;
    }

    if (this.incomingValueHandler) {
      off(this.incomingRef, 'value', this.incomingValueHandler);
      this.incomingValueHandler = null;
    }

    if (this.presenceRef) {
      remove(this.presenceRef).catch(() => {});
    }
  }

  observePresence() {
    this.connectedRef = ref(this.db, '.info/connected');
    this.presenceRef = ref(this.db, getSignalPath('presence', this.userId));

    this.presenceConnectedHandler = (snapshot) => {
      const connected = snapshot.val() === true;

      if (!connected) {
        this.callbacks.onConnectionStateChange?.(this.explicitlyClosed ? 'offline' : 'reconnecting');
        return;
      }

      this.presenceInfo = {
        appState: document.visibilityState === 'hidden' ? 'background' : 'foreground',
        connectedAt: Date.now(),
        displayName: this.userDisplayName,
        updatedAt: serverTimestamp(),
        userId: this.userId,
      };

      onDisconnect(this.presenceRef).remove().catch(() => {});
      set(this.presenceRef, this.presenceInfo).catch((error) => {
        this.callbacks.onError?.(error);
      });
      this.callbacks.onConnectionStateChange?.('online');
      this.emitSessionUpdate();
    };

    onValue(this.connectedRef, this.presenceConnectedHandler);
  }

  observeIncomingCalls() {
    this.incomingRef = ref(this.db, getSignalPath('incoming', this.userId));

    this.incomingValueHandler = (snapshot) => {
      const nextPendingCalls = getPendingCalls(snapshot.val());
      const previousIds = new Set(this.pendingCalls.map((entry) => entry.callId));

      this.pendingCalls = nextPendingCalls;
      this.emitSessionUpdate();

      for (const call of nextPendingCalls) {
        if (previousIds.has(call.callId)) {
          continue;
        }

        this.observeCall(call.callId);
        this.callbacks.onEvent?.({
          ...call,
          type: 'incoming-call',
        });
      }
    };

    onValue(this.incomingRef, this.incomingValueHandler);
  }

  emitSessionUpdate() {
    this.callbacks.onSessionUpdate?.({
      pendingCalls: this.pendingCalls,
      user: {
        displayName: this.userDisplayName,
        userId: this.userId,
      },
    });
  }

  async requestCall({ calleeUserId, mediaMode }) {
    const trimmedCalleeId = String(calleeUserId || '').trim();

    if (!trimmedCalleeId) {
      throw new Error('Target user ID is required');
    }

    const callId = push(ref(this.db, getSignalPath('calls'))).key;

    if (!callId) {
      throw new Error('Unable to allocate a call ID');
    }

    const payload = {
      callId,
      callerId: this.userId,
      callerName: this.userDisplayName,
      calleeUserId: trimmedCalleeId,
      createdAt: Date.now(),
      mediaMode,
      status: 'ringing',
      updatedAt: serverTimestamp(),
    };

    await set(ref(this.db, getSignalPath('calls', callId)), payload);
    await set(ref(this.db, getSignalPath('incoming', trimmedCalleeId, callId)), payload);

    this.observeCall(callId);
    this.scheduleRingTimeout(callId, trimmedCalleeId);
    this.callbacks.onEvent?.({
      callId,
      calleeUserId: trimmedCalleeId,
      mediaMode,
      type: 'call-request',
    });
    return callId;
  }

  async acceptCall({ callId }) {
    await update(ref(this.db, getSignalPath('calls', callId)), {
      acceptedAt: serverTimestamp(),
      status: 'accepted',
      updatedAt: serverTimestamp(),
    });
    await remove(ref(this.db, getSignalPath('incoming', this.userId, callId)));
    this.observeCall(callId);
  }

  async rejectCall({ callId, reason = 'rejected' }) {
    const callSnapshot = await get(ref(this.db, getSignalPath('calls', callId)));
    const call = callSnapshot.val();

    await update(ref(this.db, getSignalPath('calls', callId)), {
      endedAt: serverTimestamp(),
      endedReason: reason,
      status: 'rejected',
      updatedAt: serverTimestamp(),
    });
    await remove(ref(this.db, getSignalPath('incoming', this.userId, callId)));

    if (call?.calleeUserId) {
      window.clearTimeout(this.ringTimers.get(callId));
      this.ringTimers.delete(callId);
    }
  }

  async endCall({ callId, reason = 'ended' }) {
    const callSnapshot = await get(ref(this.db, getSignalPath('calls', callId)));
    const call = callSnapshot.val();

    await update(ref(this.db, getSignalPath('calls', callId)), {
      endedAt: serverTimestamp(),
      endedBy: this.userId,
      endedReason: reason,
      status: 'ended',
      updatedAt: serverTimestamp(),
    });

    if (call?.calleeUserId) {
      await remove(ref(this.db, getSignalPath('incoming', call.calleeUserId, callId))).catch(() => {});
    }

    window.clearTimeout(this.ringTimers.get(callId));
    this.ringTimers.delete(callId);
  }

  async sendOffer({ callId, description }) {
    await update(ref(this.db, getSignalPath('calls', callId)), {
      offer: {
        ...description,
        updatedAt: Date.now(),
      },
      updatedAt: serverTimestamp(),
    });
  }

  async sendAnswer({ callId, description }) {
    await update(ref(this.db, getSignalPath('calls', callId)), {
      answer: {
        ...description,
        updatedAt: Date.now(),
      },
      status: 'connected',
      updatedAt: serverTimestamp(),
    });
  }

  async sendIceCandidate({ callId, candidate }) {
    const candidateRef = push(ref(this.db, getSignalPath('candidates', callId, this.userId)));

    await set(candidateRef, {
      ...candidate,
      createdAt: Date.now(),
    });
  }

  updateAppState(appState) {
    if (!this.presenceRef) {
      return;
    }

    update(this.presenceRef, {
      appState,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }

  releaseCall(callId) {
    const observer = this.callObservers.get(callId);

    if (observer) {
      observer.dispose();
      this.callObservers.delete(callId);
    }

    window.clearTimeout(this.ringTimers.get(callId));
    this.ringTimers.delete(callId);
  }

  scheduleRingTimeout(callId, calleeUserId) {
    window.clearTimeout(this.ringTimers.get(callId));

    const timeoutId = window.setTimeout(async () => {
      try {
        const statusRef = ref(this.db, getSignalPath('calls', callId, 'status'));
        const result = await runTransaction(statusRef, (currentStatus) => {
          if (currentStatus === 'ringing') {
            return 'timeout';
          }

          return currentStatus;
        });

        if (!result.committed || result.snapshot.val() !== 'timeout') {
          return;
        }

        await update(ref(this.db, getSignalPath('calls', callId)), {
          endedAt: serverTimestamp(),
          endedReason: 'timeout',
          updatedAt: serverTimestamp(),
        });
        await remove(ref(this.db, getSignalPath('incoming', calleeUserId, callId)));
      } catch (error) {
        this.callbacks.onError?.(error);
      }
    }, this.ringTimeoutMs);

    this.ringTimers.set(callId, timeoutId);
  }

  observeCall(callId) {
    if (this.callObservers.has(callId)) {
      return this.callObservers.get(callId);
    }

    const callRef = ref(this.db, getSignalPath('calls', callId));
    const remoteCandidatesRef = ref(this.db, getSignalPath('candidates', callId));
    const observer = {
      candidateHandler: null,
      previousCall: null,
      valueHandler: null,
      dispose: () => {
        if (observer.valueHandler) {
          off(callRef, 'value', observer.valueHandler);
        }

        if (observer.candidateHandler) {
          off(remoteCandidatesRef, 'child_added', observer.candidateHandler);
        }
      },
    };

    observer.valueHandler = (snapshot) => {
      const nextCall = normalizeCallRecord(callId, snapshot.val());
      const previousCall = observer.previousCall;
      observer.previousCall = nextCall;

      if (!nextCall) {
        return;
      }

      const remoteUserId = nextCall.callerId === this.userId
        ? nextCall.calleeUserId
        : nextCall.callerId;

      if (nextCall.status !== previousCall?.status) {
        switch (nextCall.status) {
          case 'accepted':
            if (nextCall.callerId === this.userId) {
              this.callbacks.onEvent?.({
                callId,
                mediaMode: nextCall.mediaMode,
                type: 'accept-call',
              });
            }
            break;
          case 'rejected':
            this.callbacks.onEvent?.({
              callId,
              reason: nextCall.endedReason || 'rejected',
              type: 'reject-call',
            });
            break;
          case 'timeout':
            this.callbacks.onEvent?.({
              callId,
              type: 'call-timeout',
            });
            break;
          case 'ended':
            this.callbacks.onEvent?.({
              callId,
              reason: nextCall.endedReason || 'ended',
              type: 'end-call',
            });
            break;
          default:
            break;
        }
      }

      if (
        nextCall.calleeUserId === this.userId
        && nextCall.offer
        && !shallowEqualDescription(nextCall.offer, previousCall?.offer)
      ) {
        this.callbacks.onEvent?.({
          callId,
          description: nextCall.offer,
          mediaMode: nextCall.mediaMode,
          type: 'webrtc-offer',
        });
      }

      if (
        nextCall.callerId === this.userId
        && nextCall.answer
        && !shallowEqualDescription(nextCall.answer, previousCall?.answer)
      ) {
        this.callbacks.onEvent?.({
          callId,
          description: nextCall.answer,
          type: 'webrtc-answer',
        });
      }

      if (remoteUserId && observer.remoteUserId !== remoteUserId) {
        observer.remoteUserId = remoteUserId;

        if (observer.candidateHandler) {
          off(remoteCandidatesRef, 'child_added', observer.candidateHandler);
        }

        observer.candidateHandler = (candidateSnapshot) => {
          if (candidateSnapshot.key !== observer.remoteUserId) {
            return;
          }

          for (const [candidateId, candidateValue] of Object.entries(candidateSnapshot.val() || {})) {
            if (observer.seenCandidateIds?.has(candidateId)) {
              continue;
            }

            observer.seenCandidateIds ??= new Set();
            observer.seenCandidateIds.add(candidateId);
            this.callbacks.onEvent?.({
              callId,
              candidate: candidateValue,
              type: 'webrtc-ice-candidate',
            });
          }
        };

        onChildAdded(remoteCandidatesRef, observer.candidateHandler);
      }
    };

    onValue(callRef, observer.valueHandler);
    this.callObservers.set(callId, observer);
    return observer;
  }
}
