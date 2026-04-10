const { createHmac } = require('node:crypto');

function buildIceConfiguration({ turnConfig, userId }) {
  const iceServers = [];

  if (turnConfig.stunUrls.length > 0) {
    iceServers.push({
      urls: turnConfig.stunUrls,
    });
  }

  if (!turnConfig.sharedSecret || turnConfig.turnUrls.length === 0) {
    return {
      expiresAt: null,
      iceServers,
      iceTransportPolicy: turnConfig.transportPolicy,
    };
  }

  const expiresAt = Math.floor(Date.now() / 1000) + turnConfig.ttlSeconds;
  const username = `${expiresAt}:${userId}`;
  const credential = createHmac('sha1', turnConfig.sharedSecret)
    .update(username)
    .digest('base64');

  iceServers.push({
    credential,
    urls: turnConfig.turnUrls,
    username,
  });

  return {
    expiresAt,
    iceServers,
    iceTransportPolicy: turnConfig.transportPolicy,
  };
}

module.exports = {
  buildIceConfiguration,
};
