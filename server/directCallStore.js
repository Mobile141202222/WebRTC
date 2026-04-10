const { randomUUID } = require('node:crypto');

class DirectCallStore {
  constructor() {
    this.connectionsBySocketId = new Map();
    this.socketIdsByUserId = new Map();
    this.pushTokensByUserId = new Map();
    this.callsById = new Map();
    this.activeCallIdByUserId = new Map();
  }

  registerConnection(connection) {
    const normalizedConnection = {
      appState: connection.appState || 'foreground',
      connectedAt: Date.now(),
      displayName: connection.displayName,
      socketId: connection.socketId,
      userId: connection.userId,
      ws: connection.ws,
    };

    this.connectionsBySocketId.set(normalizedConnection.socketId, normalizedConnection);

    if (!this.socketIdsByUserId.has(normalizedConnection.userId)) {
      this.socketIdsByUserId.set(normalizedConnection.userId, new Set());
    }

    this.socketIdsByUserId.get(normalizedConnection.userId).add(normalizedConnection.socketId);
    return normalizedConnection;
  }

  updateConnection(socketId, patch) {
    const connection = this.connectionsBySocketId.get(socketId);

    if (!connection) {
      return null;
    }

    Object.assign(connection, patch);
    return connection;
  }

  getConnection(socketId) {
    return this.connectionsBySocketId.get(socketId) || null;
  }

  getConnectionsForUser(userId) {
    const socketIds = this.socketIdsByUserId.get(userId);

    if (!socketIds || socketIds.size === 0) {
      return [];
    }

    return [...socketIds]
      .map((socketId) => this.connectionsBySocketId.get(socketId))
      .filter(Boolean);
  }

  userHasForegroundConnection(userId) {
    return this.getConnectionsForUser(userId).some(
      (connection) => connection.appState === 'foreground',
    );
  }

  getPreferredSocketsForUser(userId, excludedSocketIds = []) {
    const excludedSet = new Set(excludedSocketIds);
    const connections = this.getConnectionsForUser(userId)
      .filter((connection) => !excludedSet.has(connection.socketId));

    if (connections.length === 0) {
      return [];
    }

    const foregroundConnections = connections.filter(
      (connection) => connection.appState === 'foreground',
    );

    return foregroundConnections.length > 0 ? foregroundConnections : connections;
  }

  registerPushToken(userId, token, metadata = {}) {
    if (!this.pushTokensByUserId.has(userId)) {
      this.pushTokensByUserId.set(userId, new Map());
    }

    this.pushTokensByUserId.get(userId).set(token, {
      platform: metadata.platform || 'web',
      updatedAt: Date.now(),
    });
  }

  unregisterPushToken(userId, token) {
    const userTokens = this.pushTokensByUserId.get(userId);

    if (!userTokens) {
      return false;
    }

    const removed = userTokens.delete(token);

    if (userTokens.size === 0) {
      this.pushTokensByUserId.delete(userId);
    }

    return removed;
  }

  removePushTokenEverywhere(token) {
    for (const [userId, userTokens] of this.pushTokensByUserId.entries()) {
      userTokens.delete(token);

      if (userTokens.size === 0) {
        this.pushTokensByUserId.delete(userId);
      }
    }
  }

  getPushTokensForUser(userId) {
    const userTokens = this.pushTokensByUserId.get(userId);
    return userTokens ? [...userTokens.keys()] : [];
  }

  getPendingIncomingCalls(userId) {
    const now = Date.now();

    return [...this.callsById.values()].filter(
      (call) => call.calleeUserId === userId && call.status === 'ringing' && call.expiresAt > now,
    );
  }

  getCall(callId) {
    return this.callsById.get(callId) || null;
  }

  getActiveCallForUser(userId) {
    const activeCallId = this.activeCallIdByUserId.get(userId);
    return activeCallId ? this.callsById.get(activeCallId) || null : null;
  }

  createCall({
    callerId,
    callerName,
    callerSocketId,
    calleeUserId,
    mediaMode,
    ringTimeoutMs,
  }) {
    if (this.getActiveCallForUser(callerId) || this.getActiveCallForUser(calleeUserId)) {
      throw new Error('User is already in another call');
    }

    const now = Date.now();
    const call = {
      calleeSocketId: null,
      calleeUserId,
      callerId,
      callerName,
      callerSocketId,
      createdAt: now,
      expiresAt: now + ringTimeoutMs,
      id: randomUUID(),
      mediaMode,
      status: 'ringing',
      updatedAt: now,
    };

    this.callsById.set(call.id, call);
    this.activeCallIdByUserId.set(callerId, call.id);
    this.activeCallIdByUserId.set(calleeUserId, call.id);

    return call;
  }

  acceptCall(callId, { socketId, userId }) {
    const call = this.getCall(callId);

    if (!call || call.status !== 'ringing') {
      throw new Error('Call is no longer available');
    }

    if (call.calleeUserId !== userId) {
      throw new Error('Only the callee can accept this call');
    }

    call.calleeSocketId = socketId;
    call.status = 'connecting';
    call.acceptedAt = Date.now();
    call.updatedAt = Date.now();

    return call;
  }

  markCallConnected(callId) {
    const call = this.getCall(callId);

    if (!call || (call.status !== 'connecting' && call.status !== 'in-call')) {
      return null;
    }

    call.status = 'in-call';
    call.updatedAt = Date.now();
    return call;
  }

  rejectCall(callId, { reason = 'rejected', userId }) {
    const call = this.getCall(callId);

    if (!call) {
      return null;
    }

    if (call.status !== 'ringing') {
      throw new Error('Call can no longer be rejected');
    }

    if (![call.callerId, call.calleeUserId].includes(userId)) {
      throw new Error('Only call participants can reject the call');
    }

    const finalizedCall = {
      ...call,
      endedAt: Date.now(),
      endedBy: userId,
      reason,
      status: 'rejected',
      updatedAt: Date.now(),
    };

    this.releaseCall(call.id);
    return finalizedCall;
  }

  endCall(callId, { reason = 'ended', userId }) {
    const call = this.getCall(callId);

    if (!call) {
      return null;
    }

    if (![call.callerId, call.calleeUserId].includes(userId)) {
      throw new Error('Only call participants can end the call');
    }

    const finalizedCall = {
      ...call,
      endedAt: Date.now(),
      endedBy: userId,
      reason,
      status: 'ended',
      updatedAt: Date.now(),
    };

    this.releaseCall(call.id);
    return finalizedCall;
  }

  expireCalls(now = Date.now()) {
    const expiredCalls = [];

    for (const call of this.callsById.values()) {
      if (call.status !== 'ringing' || call.expiresAt > now) {
        continue;
      }

      expiredCalls.push({
        ...call,
        endedAt: now,
        reason: 'timeout',
        status: 'timeout',
        updatedAt: now,
      });
      this.releaseCall(call.id);
    }

    return expiredCalls;
  }

  resolveTargetSocketId(call, senderSocketId, senderUserId) {
    if (!call) {
      return '';
    }

    if (senderUserId === call.callerId && senderSocketId === call.callerSocketId) {
      return call.calleeSocketId || '';
    }

    if (senderUserId === call.calleeUserId && senderSocketId === call.calleeSocketId) {
      return call.callerSocketId || '';
    }

    return '';
  }

  unregisterConnection(socketId) {
    const connection = this.connectionsBySocketId.get(socketId);

    if (!connection) {
      return {
        connection: null,
        disconnectedCalls: [],
      };
    }

    this.connectionsBySocketId.delete(socketId);

    const userSocketIds = this.socketIdsByUserId.get(connection.userId);

    if (userSocketIds) {
      userSocketIds.delete(socketId);

      if (userSocketIds.size === 0) {
        this.socketIdsByUserId.delete(connection.userId);
      }
    }

    const disconnectedCalls = [];

    for (const call of this.callsById.values()) {
      const isCallerSocket = call.callerSocketId === socketId;
      const isAcceptedCalleeSocket = call.calleeSocketId === socketId;

      if (!isCallerSocket && !isAcceptedCalleeSocket) {
        continue;
      }

      disconnectedCalls.push({
        ...call,
        endedAt: Date.now(),
        endedBy: connection.userId,
        reason: 'disconnect',
        status: 'ended',
        updatedAt: Date.now(),
      });
      this.releaseCall(call.id);
    }

    return {
      connection,
      disconnectedCalls,
    };
  }

  releaseCall(callId) {
    const call = this.callsById.get(callId);

    if (!call) {
      return;
    }

    if (this.activeCallIdByUserId.get(call.callerId) === callId) {
      this.activeCallIdByUserId.delete(call.callerId);
    }

    if (this.activeCallIdByUserId.get(call.calleeUserId) === callId) {
      this.activeCallIdByUserId.delete(call.calleeUserId);
    }

    this.callsById.delete(callId);
  }
}

module.exports = {
  DirectCallStore,
};
