const crypto = require('crypto');

function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!process.env.API_KEY) {
    console.error('API_KEY environment variable not set');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const a = Buffer.from(apiKey);
  const b = Buffer.from(process.env.API_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = authMiddleware;
