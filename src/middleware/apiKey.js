/**
 * Middleware to verify the X-API-Key header.
 */
function verifyApiKey(req, res, next) {
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