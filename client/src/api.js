const TOKEN_KEY = 'medidesk_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

// Feature 18: the branch the user is working in ('' = every branch)
const BRANCH_KEY = 'medidesk_branch';
export const getBranch = () => { try { return localStorage.getItem(BRANCH_KEY) || ''; } catch { return ''; } };
export const setBranch = (b) => { try { if (b) localStorage.setItem(BRANCH_KEY, b); else localStorage.removeItem(BRANCH_KEY); } catch { /* ignore */ } };
// URL that works in <img>, <a> and window.open (they cannot send headers), e.g. PDFs and QR images
export const authUrl = (url) => `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken() || '')}&branch=${encodeURIComponent(getBranch())}`;

async function request(method, url, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (getBranch()) headers['X-Branch'] = getBranch();
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new Error('Cannot reach the server. Is the API running on port 5000?');
  }
  if (res.status === 401 && !url.startsWith('/api/auth/login')) {
    setToken(null);
    window.dispatchEvent(new Event('medidesk:logout'));
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

const qs = (params = {}) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: (url, params) => request('GET', url + qs(params)),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: (file) => { const f = new FormData(); f.append('file', file); return request('POST', '/api/x/upload', f); },
  async download(url, params, filename) {
    const res = await fetch(url + qs(params), { headers: { Authorization: `Bearer ${getToken()}`, ...(getBranch() ? { 'X-Branch': getBranch() } : {}) } });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  qs,
};

// module helpers
export const mod = {
  list: (key, params) => api.get(`/api/m/${key}`, params),
  get: (key, id) => api.get(`/api/m/${key}/${id}`),
  options: (key, params) => api.get(`/api/m/${key}/options`, params),
  create: (key, body) => api.post(`/api/m/${key}`, body),
  update: (key, id, body) => api.put(`/api/m/${key}/${id}`, body),
  remove: (key, id) => api.del(`/api/m/${key}/${id}`),
  restore: (key, id) => api.post(`/api/m/${key}/${id}/restore`),
  action: (key, id, action, body) => api.post(`/api/m/${key}/${id}/actions/${action}`, body),
  tool: (key, tool, body) => api.post(`/api/m/${key}/tools/${tool}`, body),
};