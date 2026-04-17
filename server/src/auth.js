import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'ayman-chat-dev-secret-change-in-production';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
