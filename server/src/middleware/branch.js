// Feature 18: decides which branch the request works in and exposes it to the Mongoose branch plugin.
// Admins (and staff without a home branch) pick one with the X-Branch header; blank = every branch.
import { als } from '../utils/context.js';

const isId = (v) => /^[a-f\d]{24}$/i.test(String(v || ''));

export function branchContext(req, res, next) {
  let b = req.headers['x-branch'] || req.query.branch || '';
  if (req.user?.role !== 'admin' && req.user?.branch) b = String(req.user.branch); // locked to the home branch
  req.branch = isId(b) ? String(b) : null;
  als.run({ branch: req.branch }, () => next());
}