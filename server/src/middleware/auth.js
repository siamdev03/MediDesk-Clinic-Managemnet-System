import jwt from 'jsonwebtoken';
import { M } from '../config/registry.js';
import { HttpError } from '../utils/helpers.js';
import { logError } from '../utils/errorLogger.js';

export const signToken = (user) =>
  jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '7d' });

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    if (!token) throw new HttpError(401, 'Please sign in');
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw new HttpError(401, 'Session expired, please sign in again');
    }
    const user = await M('users').findOne({ _id: payload.id, deleted: { $ne: true }, active: { $ne: false } }).lean();
    if (!user) throw new HttpError(401, 'Account not found or disabled');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole = (...roles) => (req, res, next) => {
  if (req.user?.role === 'admin' || roles.includes(req.user?.role)) return next();
  return next(new HttpError(403, 'You do not have permission to do this'));
};

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  let status = err.status || 500;
  let message = err.message || 'Server error';
  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors).map((e) => e.message).join(', ');
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid value for ${err.path}`;
  } else if (err.code === 11000) {
    status = 409;
    message = 'Duplicate value – this record already exists';
  } else if (err.name === 'MulterError') {
    status = 400;
    message = err.message;
  }
  if (status >= 500) {
    console.error(err);
    logError({
      message: err.message, stack: err.stack, statusCode: status, method: req.method, path: String(req.originalUrl || '').split('?')[0],
      user: req.user, ip: req.ip, userAgent: req.headers['user-agent'],
    });
  }
  res.status(status).json({ error: status >= 500 && process.env.NODE_ENV === 'production' ? 'Server error' : message });
}