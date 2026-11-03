import { Setting } from './registry.js';

export const DEFAULT_SETTINGS = {
  clinicName: 'MediDesk Clinic & Diagnostic Center',
  tagline: 'Caring for you, always',
  address: 'House 12, Road 5, Dhanmondi, Dhaka 1205',
  phone: '+880 1700-000000',
  email: 'info@medidesk.local',
  currency: '৳',
  taxRate: 0,
  pharmacyTaxRate: 0,
  dueDays: 7,
  invoiceFooter: 'Thank you for choosing us. Get well soon!',
  openTime: '09:00',
  closeTime: '21:00',
  lowStockDefault: 10,
  expiryAlertDays: 60,
};

let cache = null;
let cachedAt = 0;

export async function getSettings() {
  if (cache && Date.now() - cachedAt < 5000) return cache;
  const doc = await Setting.findById('main').lean();
  cache = { ...DEFAULT_SETTINGS, ...(doc?.value || {}) };
  cachedAt = Date.now();
  return cache;
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const clean = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (patch[k] === undefined) continue;
    clean[k] = typeof DEFAULT_SETTINGS[k] === 'number' ? Number(patch[k]) || 0 : String(patch[k]);
  }
  const value = { ...current, ...clean };
  await Setting.findByIdAndUpdate('main', { value }, { upsert: true });
  cache = value;
  cachedAt = Date.now();
  return value;
}
