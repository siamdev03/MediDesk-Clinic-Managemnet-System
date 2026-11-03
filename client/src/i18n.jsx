// Feature 19: Bangla / English switch. t('English text') returns the Bangla text when one exists,
// otherwise the English text – so anything not translated simply stays English.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const BN = {
  // navigation
  Dashboard: 'ড্যাশবোর্ড', 'Appointment Calendar': 'অ্যাপয়েন্টমেন্ট ক্যালেন্ডার', 'Live OPD Queue': 'লাইভ ওপিডি সিরিয়াল', 'Bed Map': 'বেড ম্যাপ', Reports: 'রিপোর্ট', Settings: 'সেটিংস',
  Finance: 'অর্থ ও হিসাব', 'Doctor Dashboard': 'ডাক্তার ড্যাশবোর্ড', 'Follow-ups': 'ফলো-আপ', 'Admin Tools': 'অ্যাডমিন টুলস',
  'My profile': 'আমার প্রোফাইল', 'Sign out': 'সাইন আউট', 'Sign in': 'সাইন ইন', Email: 'ইমেইল', Password: 'পাসওয়ার্ড',
  'Search patients, doctors, invoices…  ( / )': 'রোগী, ডাক্তার, ইনভয়েস খুঁজুন…  ( / )',
  // groups
  'Front Desk': 'ফ্রন্ট ডেস্ক', Clinical: 'ক্লিনিক্যাল', Diagnostics: 'ডায়াগনস্টিক', Pharmacy: 'ফার্মেসি', Inpatient: 'ভর্তি রোগী', Billing: 'বিলিং', 'People & HR': 'কর্মী ও এইচআর', Facility: 'সুবিধা', Communication: 'যোগাযোগ', Admin: 'অ্যাডমিন',
  // modules
  Appointments: 'অ্যাপয়েন্টমেন্ট', 'OPD Queue': 'ওপিডি সিরিয়াল', Teleconsultations: 'টেলিকনসাল্টেশন', 'Visitor Log': 'ভিজিটর লগ', Patients: 'রোগী', Consultations: 'পরামর্শ', Vitals: 'ভাইটাল', Prescriptions: 'প্রেসক্রিপশন',
  Immunizations: 'টিকা', 'Patient Documents': 'রোগীর নথি', 'Medical Certificates': 'মেডিকেল সনদ', 'Lab Test Catalog': 'ল্যাব টেস্ট তালিকা', 'Lab Orders': 'ল্যাব অর্ডার', 'Radiology / Imaging': 'রেডিওলজি / ইমেজিং', 'Health Packages': 'হেলথ প্যাকেজ',
  Medicines: 'ওষুধ', 'Pharmacy Sales': 'ফার্মেসি বিক্রয়', 'Purchase Orders': 'ক্রয় অর্ডার', Suppliers: 'সরবরাহকারী', 'Stock Ledger': 'স্টক খতিয়ান', Wards: 'ওয়ার্ড', Beds: 'বেড', 'Admissions (IPD)': 'ভর্তি (আইপিডি)', 'Surgeries / OT': 'সার্জারি / ওটি',
  Ambulances: 'অ্যাম্বুলেন্স', 'Blood Bank': 'ব্লাড ব্যাংক', 'Blood Donors': 'রক্তদাতা', Invoices: 'ইনভয়েস', Payments: 'পেমেন্ট', Expenses: 'খরচ', 'Service Catalog': 'সেবা তালিকা', 'Insurance Providers': 'বীমা প্রতিষ্ঠান', 'Insurance Claims': 'বীমা দাবি',
  Doctors: 'ডাক্তার', Departments: 'বিভাগ', Staff: 'কর্মচারী', Attendance: 'উপস্থিতি', 'Leave Requests': 'ছুটির আবেদন', Payroll: 'বেতন', 'Duty Roster': 'ডিউটি রোস্টার', 'General Inventory': 'সাধারণ মজুদ', Equipment: 'যন্ত্রপাতি',
  Announcements: 'ঘোষণা', 'Patient Feedback': 'রোগীর মতামত', Tasks: 'কাজ', 'Users & Roles': 'ব্যবহারকারী ও ভূমিকা', 'Audit Log': 'অডিট লগ', 'Error Log': 'ত্রুটি লগ', Branches: 'শাখা', 'Message Log': 'বার্তা লগ',
  'Prescription Templates': 'প্রেসক্রিপশন টেমপ্লেট', 'Daily Cash Closing': 'দৈনিক ক্যাশ ক্লোজিং', 'Online Payments': 'অনলাইন পেমেন্ট',
  // fields & common words
  Patient: 'রোগী', Doctor: 'ডাক্তার', Date: 'তারিখ', Time: 'সময়', Status: 'অবস্থা', Name: 'নাম', 'Full name': 'পূর্ণ নাম', Phone: 'ফোন', Gender: 'লিঙ্গ', Age: 'বয়স', Address: 'ঠিকানা', Notes: 'নোট', Amount: 'টাকার পরিমাণ',
  Total: 'মোট', Paid: 'পরিশোধিত', Balance: 'বাকি', Price: 'মূল্য', Diagnosis: 'রোগ নির্ণয়', Medicine: 'ওষুধ', Qty: 'সংখ্যা', Discount: 'ছাড়', Fee: 'ফি', Type: 'ধরন', Reason: 'কারণ', Role: 'ভূমিকা', Active: 'সক্রিয়',
  'Blood group': 'রক্তের গ্রুপ', 'Date of birth': 'জন্ম তারিখ', Allergies: 'অ্যালার্জি', 'Payment method': 'পেমেন্ট পদ্ধতি', 'Unit price': 'একক মূল্য', Dosage: 'মাত্রা', Frequency: 'কতবার', Duration: 'মেয়াদ', Advice: 'পরামর্শ',
  'Follow-up date': 'ফলো-আপের তারিখ', 'Invoice date': 'ইনভয়েসের তারিখ', Subtotal: 'উপমোট', Tax: 'কর', Photo: 'ছবি', Specialization: 'বিশেষত্ব', 'Consultation fee': 'পরামর্শ ফি',
  // buttons & messages
  Save: 'সংরক্ষণ', Cancel: 'বাতিল', Saving: 'সংরক্ষণ হচ্ছে', New: 'নতুন', Edit: 'সম্পাদনা', Delete: 'মুছুন', Search: 'খুঁজুন', Close: 'বন্ধ', Print: 'প্রিন্ট', Back: 'পিছনে', Next: 'পরবর্তী', Confirm: 'নিশ্চিত', Loading: 'লোড হচ্ছে',
  'Add row': 'সারি যোগ', 'Nothing here yet': 'এখনও কিছু নেই', 'Book an appointment': 'অ্যাপয়েন্টমেন্ট বুক করুন', 'Patient portal': 'রোগী পোর্টাল', 'Your name': 'আপনার নাম', 'Mobile number': 'মোবাইল নম্বর',
  'Choose a doctor': 'ডাক্তার বাছুন', 'Choose a date': 'তারিখ বাছুন', 'Choose a time': 'সময় বাছুন', 'Send code': 'কোড পাঠান', Verify: 'যাচাই', 'Upcoming appointments': 'আসন্ন অ্যাপয়েন্টমেন্ট', 'Lab reports': 'ল্যাব রিপোর্ট', Bills: 'বিল', 'Pay now': 'এখনই পরিশোধ',
  'Download PDF': 'পিডিএফ ডাউনলোড', 'Booking confirmed': 'বুকিং নিশ্চিত হয়েছে', 'Two-factor login': 'টু-ফ্যাক্টর লগইন', 'Keyboard shortcuts': 'কীবোর্ড শর্টকাট', Language: 'ভাষা', Branch: 'শাখা', 'All branches': 'সব শাখা',
};

const Ctx = createContext({ lang: 'en', t: (s) => s, setLang: () => {} });
export const useLang = () => useContext(Ctx);

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => { try { return localStorage.getItem('medidesk_lang') || 'en'; } catch { return 'en'; } });
  const setLang = useCallback((l) => { setLangState(l); try { localStorage.setItem('medidesk_lang', l); } catch { /* ignore */ } }, []);
  useEffect(() => { document.documentElement.lang = lang === 'bn' ? 'bn' : 'en'; }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t: (s) => (lang === 'bn' && BN[s]) || s }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}