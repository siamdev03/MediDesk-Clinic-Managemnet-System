// Feature 6: online payment of invoices. PAYMENT_PROVIDER=mock (default) | sslcommerz | bkash
// SSLCommerz also carries Nagad, Rocket, cards and bank apps, so Nagad is offered through it.
// ⚠ The SSLCommerz and bKash calls follow the providers' published sandbox flows but could not be
//    run against the live gateways while building – test in the sandbox with your own credentials first.
import crypto from 'crypto';
import { M, nextCode } from '../config/registry.js';
import { engine } from '../config/engine.js';
import { HttpError, todayStr } from '../utils/helpers.js';
import { als } from '../utils/context.js';

const env = (k, d = '') => process.env[k] || d;
export const apiBase = () => env('PUBLIC_URL', `http://localhost:${env('PORT', '5001')}`);
export const clientBase = () => env('CLIENT_ORIGIN', 'http://localhost:5173').split(',')[0];
export const providers = () => [...(env('NODE_ENV') === 'production' && env('ALLOW_MOCK_PAYMENTS') !== 'true' ? [] : ['mock']), ...(env('SSLCOMMERZ_STORE_ID') ? ['sslcommerz'] : []), ...(env('BKASH_APP_KEY') ? ['bkash'] : [])];
const SYSTEM_USER = { name: 'Online payment', role: 'admin' };

const sslBase = () => (env('SSLCOMMERZ_SANDBOX', 'true') === 'false' ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com');
const bkBase = () => env('BKASH_BASE', 'https://tokenized.sandbox.bka.sh/v1.2.0-beta');

async function bkashToken() {
  const res = await fetch(`${bkBase()}/tokenized/checkout/token/grant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', username: env('BKASH_USERNAME'), password: env('BKASH_PASSWORD') },
    body: JSON.stringify({ app_key: env('BKASH_APP_KEY'), app_secret: env('BKASH_APP_SECRET') }),
  });
  const j = await res.json();
  if (!j.id_token) throw new HttpError(502, `bKash: ${j.statusMessage || 'token request failed'}`);
  return j.id_token;
}

// Creates the pending record and returns { url, tranId } to redirect the payer to.
export async function startPayment({ invoiceId, amount, provider = 'mock', payerPhone }) {
  if (!providers().includes(provider)) throw new HttpError(400, `Payment provider "${provider}" is not configured`);
  const inv = await M('invoices').findOne({ _id: invoiceId, deleted: { $ne: true } }).populate('patient', 'name email phone').lean();
  if (!inv) throw new HttpError(404, 'Invoice not found');
  if (inv.status === 'Cancelled' || inv.balance <= 0) throw new HttpError(400, 'This invoice has nothing to pay');
  const amt = Math.round(Math.min(Number(amount) || inv.balance, inv.balance) * 100) / 100;
  if (!(amt > 0)) throw new HttpError(400, 'Invalid amount');
  const tranId = `MD${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const op = await M('onlinePayments').create({
    code: await nextCode('OP'), invoice: inv._id, patient: inv.patient?._id, amount: amt, provider, status: 'Initiated', tranId, payerPhone, branch: inv.branch,
  });
  try {
    if (provider === 'mock') return { url: `${apiBase()}/api/pay/mock/${tranId}`, tranId };
    if (provider === 'sslcommerz') {
      const p = inv.patient || {};
      const res = await fetch(`${sslBase()}/gwprocess/v4/api.php`, {
        method: 'POST',
        body: new URLSearchParams({
          store_id: env('SSLCOMMERZ_STORE_ID'), store_passwd: env('SSLCOMMERZ_STORE_PASSWORD'), total_amount: String(amt), currency: 'BDT', tran_id: tranId,
          success_url: `${apiBase()}/api/pay/callback/sslcommerz/success`, fail_url: `${apiBase()}/api/pay/callback/sslcommerz/fail`, cancel_url: `${apiBase()}/api/pay/callback/sslcommerz/cancel`,
          cus_name: p.name || 'Patient', cus_email: p.email || 'patient@example.com', cus_add1: 'Dhaka', cus_city: 'Dhaka', cus_country: 'Bangladesh', cus_phone: p.phone || payerPhone || '01700000000',
          shipping_method: 'NO', product_name: `Invoice ${inv.code}`, product_category: 'Healthcare', product_profile: 'general',
        }),
      });
      const j = await res.json();
      if (!j.GatewayPageURL) throw new HttpError(502, `SSLCommerz: ${j.failedreason || 'could not start payment'}`);
      return { url: j.GatewayPageURL, tranId };
    }
    // bKash tokenized checkout
    const idToken = await bkashToken();
    const res = await fetch(`${bkBase()}/tokenized/checkout/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: idToken, 'X-APP-Key': env('BKASH_APP_KEY') },
      body: JSON.stringify({ mode: '0011', payerReference: payerPhone || '01', callbackURL: `${apiBase()}/api/pay/callback/bkash?tran=${tranId}`, amount: amt.toFixed(2), currency: 'BDT', intent: 'sale', merchantInvoiceNumber: tranId }),
    });
    const j = await res.json();
    if (!j.bkashURL) throw new HttpError(502, `bKash: ${j.statusMessage || 'could not start payment'}`);
    await M('onlinePayments').updateOne({ _id: op._id }, { gatewayRef: j.paymentID });
    return { url: j.bkashURL, tranId };
  } catch (e) {
    await M('onlinePayments').updateOne({ _id: op._id }, { status: 'Failed', note: String(e.message).slice(0, 200) });
    throw e;
  }
}

// Gateways are called by browsers and servers, so the result is verified here before any money is recorded.
export async function verifyWithGateway(provider, op, data) {
  if (provider === 'mock') return { ok: data.result === 'success', ref: `MOCK-${op.tranId}` };
  if (provider === 'sslcommerz') {
    if (!data.val_id) return { ok: false };
    const url = `${sslBase()}/validator/api/validationserverAPI.php?${new URLSearchParams({ val_id: data.val_id, store_id: env('SSLCOMMERZ_STORE_ID'), store_passwd: env('SSLCOMMERZ_STORE_PASSWORD'), format: 'json' })}`;
    const j = await (await fetch(url)).json();
    const ok = ['VALID', 'VALIDATED'].includes(j.status) && j.tran_id === op.tranId && Math.abs(Number(j.amount) - op.amount) < 0.5;
    return { ok, ref: j.bank_tran_id || data.val_id };
  }
  if (data.status !== 'success' || !data.paymentID) return { ok: false };
  const idToken = await bkashToken();
  const res = await fetch(`${bkBase()}/tokenized/checkout/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: idToken, 'X-APP-Key': env('BKASH_APP_KEY') },
    body: JSON.stringify({ paymentID: data.paymentID }),
  });
  const j = await res.json();
  return { ok: j.transactionStatus === 'Completed' && j.merchantInvoiceNumber === op.tranId, ref: j.trxID || data.paymentID };
}

// Idempotent: a payment is recorded once, whatever number of times the gateway calls back.
export async function completePayment(tranId, data = {}) {
  const claimed = await M('onlinePayments').findOneAndUpdate({ tranId, status: 'Initiated' }, { status: 'Processing' }, { new: true });
  if (!claimed) return M('onlinePayments').findOne({ tranId }).lean();
  try {
    const v = await verifyWithGateway(claimed.provider, claimed, data);
    if (!v.ok) {
      await M('onlinePayments').updateOne({ _id: claimed._id }, { status: data.result === 'cancel' || data.cancelled ? 'Cancelled' : 'Failed' });
      return M('onlinePayments').findById(claimed._id).lean();
    }
    await als.run({ branch: claimed.branch ? String(claimed.branch) : null }, async () => {
      const inv = await M('invoices').findById(claimed.invoice).lean();
      const amount = Math.min(claimed.amount, inv?.balance ?? claimed.amount);
      if (amount > 0) await engine.createRecord('payments', { invoice: String(claimed.invoice), amount, method: 'Mobile Banking', reference: `${claimed.provider}:${v.ref}`, date: todayStr() }, SYSTEM_USER, { internal: true });
    });
    await M('onlinePayments').updateOne({ _id: claimed._id }, { status: 'Success', gatewayRef: v.ref });
  } catch (e) {
    await M('onlinePayments').updateOne({ _id: claimed._id }, { status: 'Failed', note: String(e.message).slice(0, 200) });
  }
  return M('onlinePayments').findById(claimed._id).lean();
}