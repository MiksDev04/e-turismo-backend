/**
 * Centralized error handling middleware.
 * Always returns JSON so Flutter can parse errors consistently.
 */
function errorHandler(err, req, res, next) {
  // Multer errors (file upload)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'File too large. Maximum size is 5 MB.' });
  }

  // Validation errors from express-validator are handled in controllers,
  // but catch any that bubble up here.
  if (err.type === 'validation') {
    return res.status(422).json({ message: err.message, errors: err.errors });
  }

  // MySQL duplicate entry
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'A record with that value already exists.' });
  }

  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  if (process.env.NODE_ENV !== 'production') {
    console.error(`[${req.method}] ${req.path}`, err);
  }

  res.status(status).json({ message });
}

export default errorHandler;