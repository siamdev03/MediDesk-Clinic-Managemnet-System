import mongoose from 'mongoose';
import { featurePlugin } from './featurePlugin.js';

const { Schema } = mongoose;

function pathFor(f) {
  switch (f.type) {
    case 'number':
      return { type: Number };
    case 'date':
    case 'datetime':
      return { type: Date };
    case 'checkbox':
      return { type: Boolean };
    case 'ref':
      return { type: Schema.Types.ObjectId, ref: f.module };
    case 'multiselect':
    case 'tags':
      return { type: [String] };
    case 'items': {
      const sub = {};
      for (const sf of f.fields) sub[sf.name] = pathFor(sf);
      return { type: [new Schema(sub, { _id: true })] };
    }
    case 'password':
      return { type: String, select: false };
    default:
      return { type: String, trim: true };
  }
}

export function buildModel(cfg) {
  const def = {};
  for (const f of cfg.fields) def[f.name] = pathFor(f);
  if (cfg.prefix) def.code = { type: String, index: true };
  def.deleted = { type: Boolean, default: false, index: true };
  def.deletedAt = Date;
  def.createdBy = { type: Schema.Types.ObjectId, ref: 'users' };
  def.updatedBy = { type: Schema.Types.ObjectId, ref: 'users' };
  Object.assign(def, cfg.extraSchema || {});
  const schema = new Schema(def, { timestamps: true, strict: true });
  schema.plugin(featurePlugin, { key: cfg.key });
  return mongoose.model(cfg.key, schema, cfg.key);
}