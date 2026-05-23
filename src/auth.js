const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Fetch the secret key from environment variables
const JWT_SECRET = process.env.JWT_SECRET;
const DEVELOPERS_DB_PATH = path.join(__dirname, '../data/developers.json');

if (!JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not defined in the environment variables.');
  process.exit(1);
}

/**
 * JWT Authentication Middleware
 * Validates 'Authorization: Bearer <JWT>' header.
 * Attaches the verified payload to req.user.
 * Checks for token revocation against data/developers.json.
 */
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authorization header is missing'
    });
  }

  // Expect header in format 'Bearer <token>'
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authorization header format must be Bearer <token>'
    });
  }

  const token = parts[1];

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      // In production, we log the exact error internally but return a generic 401
      console.warn(`[AUTH FAILED] IP: ${req.ip} | Error: ${err.message} | Timestamp: ${new Date().toISOString()}`);

      const responseMessage = err.name === 'TokenExpiredError' 
        ? 'Token has expired' 
        : 'Invalid or malformed token';

      return res.status(401).json({
        error: 'Unauthorized',
        message: responseMessage
      });
    }

    // Dynamic database check for token revocation
    fs.readFile(DEVELOPERS_DB_PATH, 'utf8', (readErr, dbData) => {
      if (readErr) {
        console.error(`[DB ERROR] Failed to read developers database during auth check: ${readErr.message}`);
        // Fail-safe: if database read error occurs, allow validated token to proceed to prevent service outage
        return proceed();
      }

      let developers = [];
      try {
        developers = JSON.parse(dbData);
      } catch (parseErr) {
        console.error(`[DB ERROR] Failed to parse developers database: ${parseErr.message}`);
        return proceed();
      }

      const matchedDevToken = developers.find(dev => dev.token === token);
      if (matchedDevToken && matchedDevToken.status === 'revoked') {
        console.warn(`[REVOKED ACCESS ATTEMPT] IP: ${req.ip} | User: ${decoded.email || decoded.id} | Timestamp: ${new Date().toISOString()}`);
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'This token has been revoked by the administrator.'
        });
      }

      proceed();
    });

    function proceed() {
      // Attach decoded user information to request
      req.user = {
        id: decoded.sub || decoded.id || 'anonymous',
        email: decoded.email || null,
        role: decoded.role || null,
        raw: decoded
      };
      next();
    }
  });
}

module.exports = verifyToken;
