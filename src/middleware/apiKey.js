/**
 * Public paths that do not require an API key.
 */
const PUBLIC_PATHS = ['/api/confirm-email', '/api/admin-setup/confirm', '/api/register/confirm', '/health'];

/**
 * Middleware to verify the X-API-Key header.
 */
function verifyApiKey(req, res, next) {
  if (PUBLIC_PATHS.includes(req.path)) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.API_KEY;

  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ 
      message: 'Unauthorized: Missing or invalid API Key' 
    });
  }

  next();
}

export default verifyApiKey;