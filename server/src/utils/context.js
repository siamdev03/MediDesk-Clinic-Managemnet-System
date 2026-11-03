import { AsyncLocalStorage } from 'async_hooks';

// Per-request context (the branch the user is working in). Read by the Mongoose branch plugin.
export const als = new AsyncLocalStorage();
export const currentBranch = () => als.getStore()?.branch || null;