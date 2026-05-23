const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not defined in the environment variables.');
  process.exit(1);
}

/**
 * Admin JWT Authentication Middleware
 * Enforces 'Authorization: Bearer <AdminJWT>' with admin claims.
 */
function verifyAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin authorization session is missing.'
    });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin authorization header format must be Bearer <token>'
    });
  }

  const token = parts[1];

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.warn(`[ADMIN AUTH FAILURE] IP: ${req.ip} | Error: ${err.message} | Timestamp: ${new Date().toISOString()}`);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Admin session is invalid or expired. Please log in again.'
      });
    }

    // Strictly enforce role check to prevent developers from accessing admin dashboard APIs!
    if (decoded.role !== 'admin') {
      console.warn(`[ADMIN ACCESS BYPASSED ATTEMPT] IP: ${req.ip} | User: ${decoded.email} | Timestamp: ${new Date().toISOString()}`);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access Denied: Administrative privileges required.'
      });
    }

    req.admin = decoded;
    next();
  });
}

module.exports = verifyAdminToken;
