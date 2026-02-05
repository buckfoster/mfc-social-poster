function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!process.env.API_KEY) {
    console.error('API_KEY environment variable not set');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = authMiddleware;
