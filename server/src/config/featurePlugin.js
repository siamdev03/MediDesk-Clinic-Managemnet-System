// Mongoose plugin applied to every module model:
//  • Feature 18 (multi-branch): adds a `branch` field, auto-stamps new records and scopes every read to the
//    branch chosen in the request (X-Branch header). Records created before branches existed (no branch) stay
//    visible in every branch.
//  • Feature 25 (real-time): announces every write to WebSocket clients.
import mongoose from 'mongoose';
import { currentBranch } from '../utils/context.js';
import { emitChange } from '../services/realtime.js';

const UNSCOPED = new Set(['users', 'branches', 'errorLogs', 'auditLogs', 'messageLogs']);
const visible = (b) => ({ $or: [{ branch: b }, { branch: { $exists: false } }, { branch: null }] });

export function featurePlugin(schema, { key }) {
  if (!UNSCOPED.has(key)) {
    schema.add({ branch: { type: mongoose.Schema.Types.ObjectId, ref: 'branches', index: true } });
    const scope = function scopeToBranch() {
      const b = currentBranch();
      if (b) this.and([visible(b)]);
    };
    ['find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'updateOne', 'updateMany', 'distinct'].forEach((h) => schema.pre(h, scope));
    schema.pre('aggregate', function scopeAggregate() {
      const b = currentBranch();
      if (b) this.pipeline().unshift({ $match: visible(new mongoose.Types.ObjectId(b)) });
    });
    schema.pre('save', function stamp(next) {
      if (this.isNew && !this.branch) {
        const b = currentBranch();
        if (b) this.branch = b;
      }
      next();
    });
  }
  schema.post('save', (doc) => emitChange(key, doc.branch));
  schema.post('updateMany', () => emitChange(key));
  schema.post('findOneAndUpdate', () => emitChange(key));
}