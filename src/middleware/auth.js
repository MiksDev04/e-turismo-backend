import jwt from 'jsonwebtoken';

/**
 * Verifies the Bearer token in the Authorization header.
 * Attaches decoded payload as req.user = { id, role, ... }
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing or invalid authorization header' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token expired or invalid' });
  }
}

/**
 * Role guard — call after authenticate().
 * Usage: router.get('/admin-only', authenticate, requireRole('admin'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden: insufficient permissions' });
    }
    next();
  };
}

export default { authenticate, requireRole };