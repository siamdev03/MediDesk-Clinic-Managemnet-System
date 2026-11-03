// "Error Log" module: server errors (5xx, crashes) and browser errors, visible to administrators only.
import { text, area, num, dtime, sel } from './fields.js';

export const errorLogModule = {
  key: 'errorLogs', label: 'Error Log', group: 'Admin', icon: '🐞',
  display: ['message'], search: ['message', 'path', 'userName', 'stack'], dateField: 'lastSeenAt', sort: { lastSeenAt: -1 },
  roles: { read: ['admin'], write: [], delete: ['admin'] }, readOnly: true,
  extraSchema: { fingerprint: { type: String, index: true } },
  fields: [
    dtime('lastSeenAt', 'Last seen', { form: false, list: true }),
    sel('source', 'Source', ['server', 'client'], { form: false, list: true, filter: true }),
    sel('level', 'Level', ['error', 'warning'], { form: false, list: true, filter: true }),
    text('message', 'Message', { form: false, list: true }),
    num('statusCode', 'HTTP status', { form: false, list: true, filter: true }),
    text('method', 'Method', { form: false }),
    text('path', 'Path / page', { form: false, list: true }),
    num('occurrences', 'Times seen', { form: false, list: true }),
    text('userName', 'User', { form: false }),
    text('ip', 'IP address', { form: false }),
    text('userAgent', 'Browser / client', { form: false }),
    area('stack', 'Stack trace', { form: false }),
    sel('status', 'Status', ['Open', 'Resolved'], { form: false, list: true, filter: true }),
    text('resolvedBy', 'Resolved by', { form: false }),
    dtime('resolvedAt', 'Resolved at', { form: false }),
  ],
};

export const errorLogLogic = {
  actions: [
    {
      key: 'resolve', label: 'Mark resolved', roles: ['admin'], when: { field: 'status', in: ['Open'] },
      run: (d, input, ctx) => { d.status = 'Resolved'; d.resolvedBy = ctx.user.name; d.resolvedAt = new Date(); },
    },
    {
      key: 'reopen', label: 'Re-open', roles: ['admin'], when: { field: 'status', in: ['Resolved'] },
      run: (d) => { d.status = 'Open'; d.resolvedBy = undefined; d.resolvedAt = undefined; },
    },
  ],
  tools: [
    {
      key: 'clearResolved', label: 'Delete resolved logs', roles: ['admin'],
      async run(input, ctx) {
        const r = await ctx.M('errorLogs').deleteMany({ status: 'Resolved' });
        return { message: `${r.deletedCount} resolved log(s) deleted` };
      },
    },
    {
      key: 'clearOlder', label: 'Delete old logs', roles: ['admin'], fields: [num('days', 'Delete logs older than (days)', { required: true, default: 30, min: 1 })],
      async run(input, ctx) {
        const cutoff = new Date(Date.now() - Number(input.days) * 86400000);
        const r = await ctx.M('errorLogs').deleteMany({ lastSeenAt: { $lt: cutoff } });
        return { message: `${r.deletedCount} log(s) older than ${input.days} days deleted` };
      },
    },
  ],
};