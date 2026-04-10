const { createGoogleServiceAccountAssertion } = require('./auth');

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let cachedAccessToken = {
  accessToken: '',
  expiresAt: 0,
};

function isFcmConfigured(pushConfig) {
  return Boolean(
    pushConfig.fcmProjectId
    && pushConfig.fcmClientEmail
    && pushConfig.fcmPrivateKey,
  );
}

async function getFcmAccessToken(pushConfig) {
  if (!isFcmConfigured(pushConfig)) {
    throw new Error('FCM credentials are incomplete');
  }

  if (cachedAccessToken.accessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.accessToken;
  }

  const assertion = createGoogleServiceAccountAssertion({
    clientEmail: pushConfig.fcmClientEmail,
    privateKey: pushConfig.fcmPrivateKey,
    scope: FCM_SCOPE,
  });

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    body: new URLSearchParams({
      assertion,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });
  const tokenPayload = await tokenResponse.json();

  if (!tokenResponse.ok) {
    throw new Error(tokenPayload.error_description || 'Unable to fetch FCM access token');
  }

  cachedAccessToken = {
    accessToken: tokenPayload.access_token,
    expiresAt: Date.now() + (Number(tokenPayload.expires_in || 3600) * 1000),
  };

  return cachedAccessToken.accessToken;
}

function buildCallNotification({ call, appBaseUrl, pushConfig }) {
  const notificationUrl = `${appBaseUrl}/direct-call?callId=${encodeURIComponent(call.id)}`;
  const callerLabel = call.callerName || call.callerId;
  const title = `Incoming ${call.mediaMode} call`;
  const body = `${callerLabel} is calling you`;

  return {
    android: {
      priority: 'high',
    },
    data: {
      callId: call.id,
      callerId: call.callerId,
      callerName: call.callerName || '',
      mediaMode: call.mediaMode,
      type: 'incoming-call',
      url: notificationUrl,
    },
    notification: {
      body,
      title,
    },
    token: '',
    webpush: {
      fcmOptions: {
        link: notificationUrl,
      },
      headers: {
        TTL: '30',
        Urgency: 'high',
      },
      notification: {
        body,
        data: {
          callId: call.id,
          type: 'incoming-call',
          url: notificationUrl,
        },
        icon: pushConfig.notificationIcon,
        renotify: true,
        requireInteraction: true,
        tag: `call-${call.id}`,
        title: pushConfig.appName,
      },
    },
  };
}

function isTokenUnregistered(result) {
  const errorCode = result?.error?.details?.[0]?.errorCode;
  return errorCode === 'UNREGISTERED' || errorCode === 'INVALID_ARGUMENT';
}

async function sendPushNotification({
  appBaseUrl,
  call,
  pushConfig,
  token,
}) {
  const accessToken = await getFcmAccessToken(pushConfig);
  const message = buildCallNotification({
    appBaseUrl,
    call,
    pushConfig,
  });

  message.token = token;

  const pushResponse = await fetch(
    `https://fcm.googleapis.com/v1/projects/${pushConfig.fcmProjectId}/messages:send`,
    {
      body: JSON.stringify({ message }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  const result = await pushResponse.json().catch(() => null);

  return {
    invalidToken: !pushResponse.ok && isTokenUnregistered(result),
    ok: pushResponse.ok,
    result,
  };
}

module.exports = {
  isFcmConfigured,
  sendPushNotification,
};
