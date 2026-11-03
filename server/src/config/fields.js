// Tiny DSL used to describe every module's fields once.
// The same definition drives: Mongoose schema, validation, API meta and the React forms/tables.
const mk = (type) => (name, label, opts = {}) => ({ name, label, type, ...opts });

export const text = mk('text');
export const email = mk('email');
export const phone = mk('phone');
export const url = mk('url');
export const area = mk('textarea');
export const num = mk('number');
export const money = (name, label, opts = {}) => ({ name, label, type: 'number', money: true, ...opts });
export const date = mk('date');
export const dtime = mk('datetime');
export const time = mk('time');
export const month = mk('month');
export const bool = mk('checkbox');
export const file = mk('file');
export const password = mk('password');
export const tags = mk('tags');
export const sel = (name, label, options, opts = {}) => ({ name, label, type: 'select', options, ...opts });
export const multi = (name, label, options, opts = {}) => ({ name, label, type: 'multiselect', options, ...opts });
export const ref = (name, label, module, opts = {}) => ({ name, label, type: 'ref', module, ...opts });
export const items = (name, label, fields, opts = {}) => ({ name, label, type: 'items', fields, ...opts });
