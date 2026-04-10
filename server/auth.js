const { createHmac, createSign, createVerify, timingSafeEqual } = require('node:crypto');

function base64UrlEncode(input) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(String(input));

  return source
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const normalized = String(input)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));

  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function safeJsonParse(input) {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function parseJwt(token) {
  const parts = String(token || '').split('.');

  if (parts.length !== 3) {
    throw new Error('Malformed token');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = safeJsonParse(base64UrlDecode(encodedHeader).toString('utf8'));
  const payload = safeJsonParse(base64UrlDecode(encodedPayload).toString('utf8'));

  if (!header || !payload) {
    throw new Error('Invalid token payload');
  }

  return {
    header,
    payload,
    signature: base64UrlDecode(encodedSignature),
    signingInput: `${encodedHeader}.${encodedPayload}`,
  };
}

function verifySignature(parsedToken, authConfig) {
  const { header, signature, signingInput } = parsedToken;
  const algorithm = authConfig.jwtAlgorithm || 'HS256';

  if (header.alg !== algorithm) {
    throw new Error('Unexpected JWT algorithm');
  }

  if (algorithm === 'HS256') {
    if (!authConfig.jwtSecret) {
      throw new Error('AUTH_JWT_SECRET is missing');
    }

    const expectedSignature = createHmac('sha256', authConfig.jwtSecret)
      .update(signingInput)
      .digest();

    if (
      signature.length !== expectedSignature.length
      || !timingSafeEqual(signature, expectedSignature)
    ) {
      throw new Error('Invalid token signature');
    }

    return;
  }

  if (algorithm === 'RS256') {
    if (!authConfig.jwtPublicKey) {
      throw new Error('AUTH_JWT_PUBLIC_KEY is missing');
    }

    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingInput);
    verifier.end();

    if (!verifier.verify(authConfig.jwtPublicKey, signature)) {
      throw new Error('Invalid token signature');
    }

    return;
  }

  throw new Error(`Unsupported JWT algorithm: ${algorithm}`);
}

function validateClaimAudience(actualAudience, expectedAudience) {
  if (!expectedAudience) {
    return true;
  }

  if (Array.isArray(actualAudience)) {
    return actualAudience.includes(expectedAudience);
  }

  return actualAudience === expectedAudience;
}

function normalizeAuthContext(payload) {
  const userId = payload.sub || payload.userId || '';

  if (!userId) {
    throw new Error('JWT payload is missing sub');
  }

  return {
    displayName: payload.name || payload.displayName || String(userId),
    rawClaims: payload,
    userId: String(userId),
  };
}

function verifyJwt(token, authConfig) {
  const parsedToken = parseJwt(token);
  verifySignature(parsedToken, authConfig);

  const { payload } = parsedToken;
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && Number(payload.exp) <= now) {
    throw new Error('Token has expired');
  }

  if (payload.nbf && Number(payload.nbf) > now) {
    throw new Error('Token is not active yet');
  }

  if (authConfig.issuer && payload.iss !== authConfig.issuer) {
    throw new Error('Unexpected token issuer');
  }

  if (!validateClaimAudience(payload.aud, authConfig.audience)) {
    throw new Error('Unexpected token audience');
  }

  return normalizeAuthContext(payload);
}

function extractBearerToken(request) {
  const authorizationHeader = request.headers.authorization || '';
  const [scheme, token] = authorizationHeader.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return '';
  }

  return token;
}

function authenticateHttpRequest(authConfig) {
  return (request, response, next) => {
    try {
      const token = extractBearerToken(request);

      if (!token) {
        response.status(401).json({ error: 'Missing bearer token' });
        return;
      }

      request.auth = verifyJwt(token, authConfig);
      next();
    } catch (error) {
      response.status(401).json({
        error: error.message || 'Authentication failed',
      });
    }
  };
}

function createSignedHs256Token(payload, secret) {
  const encodedHeader = base64UrlEncode(
    JSON.stringify({
      alg: 'HS256',
      typ: 'JWT',
    }),
  );
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(signingInput)
    .digest();

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function createDevToken({ userId, displayName }, authConfig) {
  if (!authConfig.devTokenSecret) {
    throw new Error('DEV_AUTH_JWT_SECRET is missing');
  }

  const now = Math.floor(Date.now() / 1000);

  return createSignedHs256Token(
    {
      sub: String(userId),
      name: displayName || String(userId),
      iat: now,
      exp: now + authConfig.devTokenTtlSeconds,
      iss: authConfig.issuer || 'roomkit-dev-auth',
      ...(authConfig.audience ? { aud: authConfig.audience } : {}),
    },
    authConfig.devTokenSecret,
  );
}

function createGoogleServiceAccountAssertion({ clientEmail, privateKey, scope }) {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64UrlEncode(
    JSON.stringify({
      alg: 'RS256',
      typ: 'JWT',
    }),
  );
  const encodedPayload = base64UrlEncode(
    JSON.stringify({
      iss: clientEmail,
      scope,
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');

  signer.update(signingInput);
  signer.end();

  return `${signingInput}.${base64UrlEncode(signer.sign(privateKey))}`;
}

module.exports = {
  authenticateHttpRequest,
  createDevToken,
  createGoogleServiceAccountAssertion,
  extractBearerToken,
  safeJsonParse,
  verifyJwt,
};
