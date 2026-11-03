// Demo data for MediDesk.   npm run seed        (only if the database is empty)
//                           npm run seed:fresh  (wipes every collection first)
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { M, moduleList, Counter, Setting } from './config/registry.js';
import { createRecord, runAction } from './config/engine.js';
import { addDays, todayDate, ymd } from './utils/helpers.js';

const fresh = process.argv.includes('--fresh');
const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/medidesk';

// deterministic pseudo random so every seed run looks the same
let seedState = 20261103;
const rnd = () => {
  seedState |= 0; seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => Math.floor(a + rnd() * (b - a + 1));

const today = todayDate();
const day = (n) => ymd(addDays(today, n));
// next non-Friday day (clinic closed on Fridays in the default doctor schedule)
const workday = (n) => { let x = n; while (addDays(today, x).getUTCDay() === 5) x += 1; return day(x); };

let admin;
const warnings = [];
async function mk(key, body, opts = {}) {
  try {
    return await createRecord(key, body, admin, { internal: true, ...opts });
  } catch (e) {
    warnings.push(`${key}: ${e.message}`);
    return null;
  }
}
const id = (r) => (r ? String(r._id) : undefined);
const log = (m) => console.log(`  ✔ ${m}`);

async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 6000 });
  console.log(`Connected to ${uri}`);

  if (fresh) {
    console.log('Dropping all MediDesk collections…');
    for (const m of moduleList) await M(m.key).deleteMany({});
    await Counter.deleteMany({});
    await Setting.deleteMany({});
  } else if (await M('users').countDocuments({})) {
    console.log('Database already has data. Use "npm run seed:fresh" to wipe and reseed.');
    await mongoose.disconnect();
    return;
  }

  // ── users ──
  admin = await M('users').create({ name: 'System Administrator', email: 'admin@medidesk.com', password: await bcrypt.hash('Admin@123', 10), role: 'admin', active: true });
  const staffUsers = [
    ['Dr. Demo Doctor', 'doctor@medidesk.com', 'doctor'], ['Nurse Demo', 'nurse@medidesk.com', 'nurse'],
    ['Reception Demo', 'reception@medidesk.com', 'receptionist'], ['Pharmacist Demo', 'pharmacy@medidesk.com', 'pharmacist'],
    ['Lab Tech Demo', 'lab@medidesk.com', 'labtech'], ['Accountant Demo', 'accounts@medidesk.com', 'accountant'],
  ];
  for (const [name, email, role] of staffUsers) await mk('users', { name, email, role, password: 'Pass@123', active: true });
  log('users (admin + 6 role accounts)');

  // ── departments & doctors ──
  const deptNames = ['General Medicine', 'Cardiology', 'Pediatrics', 'Gynecology & Obstetrics', 'Orthopedics', 'Dermatology', 'ENT', 'Neurology'];
  const dept = {};
  for (const n of deptNames) dept[n] = id(await mk('departments', { name: n, location: `Floor ${between(1, 4)}`, phone: `+8801700${between(100000, 999999)}` }));

  const doctorDefs = [
    ['Dr. Rahim Chowdhury', 'Male', 'General Physician', 'General Medicine', 'MBBS, FCPS (Medicine)', 15, 800],
    ['Dr. Nusrat Jahan', 'Female', 'Cardiologist', 'Cardiology', 'MBBS, MD (Cardiology)', 12, 1500],
    ['Dr. Tanvir Ahmed', 'Male', 'Pediatrician', 'Pediatrics', 'MBBS, DCH', 9, 1000],
    ['Dr. Farzana Akter', 'Female', 'Gynecologist', 'Gynecology & Obstetrics', 'MBBS, FCPS (Gynae)', 14, 1200],
    ['Dr. Sabbir Hossain', 'Male', 'Orthopedic Surgeon', 'Orthopedics', 'MBBS, MS (Ortho)', 11, 1300],
    ['Dr. Mahmuda Khatun', 'Female', 'Dermatologist', 'Dermatology', 'MBBS, DDV', 8, 1000],
    ['Dr. Imran Kabir', 'Male', 'ENT Specialist', 'ENT', 'MBBS, DLO', 10, 900],
    ['Dr. Shaila Sharmin', 'Female', 'Neurologist', 'Neurology', 'MBBS, MD (Neurology)', 13, 1600],
  ];
  const doctors = [];
  for (const [name, gender, specialization, d, qualification, experienceYears, fee] of doctorDefs) {
    const rec = await mk('doctors', {
      name, gender, specialization, department: dept[d], qualification, experienceYears, fee, phone: `+88017${between(10000000, 99999999)}`,
      email: `${name.split(' ')[1].toLowerCase()}@medidesk.com`, room: `Room ${between(101, 320)}`, startTime: '09:00', endTime: '17:00', slotMinutes: 15,
      workDays: ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'], status: 'Active',
    });
    if (rec) doctors.push(rec);
  }
  log(`${deptNames.length} departments, ${doctors.length} doctors`);

  // ── catalogs ──
  const services = [
    ['General consultation', 'Consultation', 500], ['Specialist consultation', 'Consultation', 1000], ['Emergency visit', 'Emergency', 1500],
    ['Dressing / wound care', 'Procedure', 300], ['Injection (IM/IV) charge', 'Nursing', 100], ['ECG', 'Procedure', 400], ['Nebulization', 'Procedure', 250],
    ['Suturing (minor)', 'Procedure', 1200], ['Oxygen per hour', 'Nursing', 150], ['Physiotherapy session', 'Procedure', 700], ['Observation bed (per day)', 'Room', 1500], ['Ambulance local trip', 'Other', 1000],
  ];
  const svc = [];
  for (const [name, category, price] of services) svc.push(await mk('services', { name, category, price, active: true }));

  const tests = [
    ['Complete Blood Count (CBC)', 'Hematology', 'Whole blood', 450, '', '4.0-11.0'], ['Hemoglobin', 'Hematology', 'Whole blood', 200, 'g/dL', '12-17'],
    ['Blood Glucose (Fasting)', 'Biochemistry', 'Serum', 150, 'mg/dL', '70-100'], ['Blood Glucose (2h ABF)', 'Biochemistry', 'Serum', 150, 'mg/dL', '70-140'],
    ['Serum Creatinine', 'Biochemistry', 'Serum', 350, 'mg/dL', '0.6-1.3'], ['Lipid Profile', 'Biochemistry', 'Serum', 900, 'mg/dL', '0-200'],
    ['SGPT (ALT)', 'Biochemistry', 'Serum', 350, 'U/L', '7-56'], ['Urine R/E', 'Urine', 'Urine', 200, '', ''], ['TSH', 'Hormone', 'Serum', 800, 'mIU/L', '0.4-4.0'],
    ['HbA1c', 'Biochemistry', 'Whole blood', 900, '%', '4.0-5.6'], ['Dengue NS1', 'Serology', 'Serum', 1000, '', ''], ['Widal Test', 'Serology', 'Serum', 400, '', ''],
    ['Vitamin D', 'Hormone', 'Serum', 2200, 'ng/mL', '30-100'], ['CRP', 'Immunology', 'Serum', 600, 'mg/L', '0-6'],
  ];
  const labTests = [];
  for (const [name, category, sampleType, price, unit, normalRange] of tests) labTests.push(await mk('labTests', { name, category, sampleType, price, unit, normalRange, turnaroundHours: 24, active: true }));

  const suppliers = [];
  for (const [name, contactPerson] of [['Square Distributors Ltd', 'Mr. Alam'], ['Beximco Pharma Supply', 'Ms. Rupa'], ['Incepta Wholesale', 'Mr. Karim'], ['ACI Health Care', 'Mr. Jewel']]) {
    suppliers.push(await mk('suppliers', { name, contactPerson, phone: `+88018${between(10000000, 99999999)}`, paymentTerms: '30 days', active: true }));
  }

  const meds = [
    ['Napa 500', 'Paracetamol', 'Analgesic', 'Tablet', '500 mg', 1.2, 1.8, 600], ['Napa Extend', 'Paracetamol', 'Analgesic', 'Tablet', '665 mg', 1.8, 2.5, 400],
    ['Ace Plus', 'Paracetamol + Caffeine', 'Analgesic', 'Tablet', '500/65 mg', 1.9, 2.6, 300], ['Seclo 20', 'Omeprazole', 'Gastro', 'Capsule', '20 mg', 4, 6, 500],
    ['Losectil 20', 'Omeprazole', 'Gastro', 'Capsule', '20 mg', 4.2, 6, 350], ['Maxpro 20', 'Esomeprazole', 'Gastro', 'Tablet', '20 mg', 6, 8, 280],
    ['Azithro 500', 'Azithromycin', 'Antibiotic', 'Tablet', '500 mg', 30, 40, 150], ['Cef-3', 'Cefixime', 'Antibiotic', 'Capsule', '200 mg', 22, 30, 120],
    ['Amoxil 500', 'Amoxicillin', 'Antibiotic', 'Capsule', '500 mg', 8, 12, 260], ['Ciprocin 500', 'Ciprofloxacin', 'Antibiotic', 'Tablet', '500 mg', 11, 15, 180],
    ['Flagyl 400', 'Metronidazole', 'Antibiotic', 'Tablet', '400 mg', 2.5, 4, 340], ['Fexo 120', 'Fexofenadine', 'Antihistamine', 'Tablet', '120 mg', 8, 12, 220],
    ['Montene 10', 'Montelukast', 'Respiratory', 'Tablet', '10 mg', 14, 20, 140], ['Ventolin Inhaler', 'Salbutamol', 'Respiratory', 'Inhaler', '100 mcg', 280, 340, 40],
    ['Napa Syrup', 'Paracetamol', 'Analgesic', 'Syrup', '120 mg/5 ml', 28, 38, 90], ['Amlovas 5', 'Amlodipine', 'Antihypertensive', 'Tablet', '5 mg', 3.5, 5, 420],
    ['Losartan 50', 'Losartan', 'Antihypertensive', 'Tablet', '50 mg', 6, 9, 300], ['Metformin 500', 'Metformin', 'Antidiabetic', 'Tablet', '500 mg', 2.2, 3.5, 450],
    ['Glimepiride 2', 'Glimepiride', 'Antidiabetic', 'Tablet', '2 mg', 4.5, 7, 200], ['Atova 10', 'Atorvastatin', 'Cardiac', 'Tablet', '10 mg', 9, 14, 260],
    ['Ecosprin 75', 'Aspirin', 'Cardiac', 'Tablet', '75 mg', 0.8, 1.5, 500], ['Calbo-D', 'Calcium + Vitamin D', 'Vitamin', 'Tablet', '500 mg', 4, 6, 380],
    ['Vitamin C 500', 'Ascorbic acid', 'Vitamin', 'Tablet', '500 mg', 2, 3.5, 260], ['Neurobion', 'Vitamin B complex', 'Vitamin', 'Tablet', 'B1/B6/B12', 6, 9, 220],
    ['Betnovate Cream', 'Betamethasone', 'Dermatology', 'Cream', '0.1%', 45, 65, 60], ['Canesten Cream', 'Clotrimazole', 'Dermatology', 'Cream', '1%', 55, 80, 50],
    ['Tobradex Drops', 'Tobramycin + Dexamethasone', 'Other', 'Drops', '5 ml', 110, 150, 35], ['Normal Saline 500ml', 'Sodium chloride', 'Injection/IV', 'Injection', '0.9%', 55, 80, 70],
    ['Ceftriaxone 1g', 'Ceftriaxone', 'Injection/IV', 'Injection', '1 g', 60, 90, 8], // low stock on purpose
    ['Old Cough Syrup', 'Bromhexine', 'Respiratory', 'Syrup', '100 ml', 40, 60, 12], // expired on purpose
  ];
  const medicines = [];
  for (let i = 0; i < meds.length; i += 1) {
    const [name, genericName, category, form, strength, purchasePrice, price, stock] = meds[i];
    const expiry = i === meds.length - 1 ? day(-20) : i === 5 ? day(35) : day(between(200, 700));
    medicines.push(await mk('medicines', {
      name, genericName, category, form, strength, supplier: id(pick(suppliers)), batchNo: `B${between(1000, 9999)}`, expiryDate: expiry, stock, reorderLevel: 20,
      purchasePrice, price, rack: `R${between(1, 9)}-${between(1, 6)}`, manufacturer: pick(['Square', 'Beximco', 'Incepta', 'ACI', 'Renata']), active: true,
    }));
  }
  const med = (n) => medicines.find((m) => m && m.name === n);
  log(`${svc.length} services, ${labTests.length} lab tests, ${suppliers.length} suppliers, ${medicines.length} medicines`);

  const insurers = [];
  for (const n of ['Delta Life Insurance', 'Green Delta Insurance', 'MetLife Bangladesh']) insurers.push(await mk('insuranceProviders', { name: n, phone: `+88096${between(10000000, 99999999)}`, active: true }));

  const icd = [
    ['J00', 'Acute nasopharyngitis (common cold)', 'Respiratory'], ['J02.9', 'Acute pharyngitis', 'Respiratory'], ['J45.9', 'Asthma, unspecified', 'Respiratory'], ['A09', 'Gastroenteritis and colitis', 'Digestive'],
    ['K29.7', 'Gastritis, unspecified', 'Digestive'], ['I10', 'Essential hypertension', 'Circulatory'], ['E11.9', 'Type 2 diabetes mellitus', 'Endocrine'], ['R50.9', 'Fever, unspecified', 'Symptoms'],
    ['A91', 'Dengue haemorrhagic fever', 'Infectious'], ['M54.5', 'Low back pain', 'Musculoskeletal'], ['L30.9', 'Dermatitis, unspecified', 'Skin'], ['N39.0', 'Urinary tract infection', 'Genitourinary'],
    ['G43.9', 'Migraine, unspecified', 'Nervous'], ['H66.9', 'Otitis media, unspecified', 'ENT'], ['D64.9', 'Anaemia, unspecified', 'Blood'],
  ];
  const icdRecs = [];
  for (const [icdCode, description, category] of icd) icdRecs.push(await mk('icdcodes', { icd: icdCode, description, category }));

  // ── wards & beds ──
  const wardDefs = [['General Ward (Male)', 'General', '1', 800, 6], ['General Ward (Female)', 'General', '1', 800, 6], ['Private Cabin', 'Private', '2', 3500, 4], ['ICU', 'ICU', '3', 8000, 4], ['Maternity Ward', 'Maternity', '2', 1500, 4]];
  const beds = [];
  for (const [name, type, floor, chargePerDay, n] of wardDefs) {
    const w = await mk('wards', { name, type, floor, chargePerDay, active: true });
    for (let i = 1; i <= n; i += 1) beds.push(await mk('beds', { ward: id(w), bedNumber: `${name.split(' ')[0].slice(0, 3).toUpperCase()}-${String(i).padStart(2, '0')}`, dailyCharge: chargePerDay, status: 'Available' }));
  }
  log(`${wardDefs.length} wards, ${beds.length} beds`);

  // ── patients ──
  const male = ['Abdul Karim', 'Mohammad Hasan', 'Rafiqul Islam', 'Shahidul Alam', 'Jahangir Hossain', 'Mizanur Rahman', 'Kamrul Hasan', 'Nazmul Huda', 'Arif Mahmud', 'Sohel Rana', 'Tarek Aziz', 'Fahim Shahriar'];
  const female = ['Fatema Begum', 'Rokeya Khatun', 'Nasrin Sultana', 'Salma Akter', 'Shirin Parvin', 'Rubina Yasmin', 'Taslima Nasrin', 'Mitu Rani', 'Sharmin Islam', 'Lipi Akter', 'Jannatul Ferdous', 'Anika Tabassum'];
  const cities = ['Dhaka', 'Chattogram', 'Gazipur', 'Narayanganj', 'Cumilla', 'Mymensingh', 'Savar', 'Tangail'];
  const bgs = ['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-'];
  const patients = [];
  for (let i = 0; i < 24; i += 1) {
    const isMale = i % 2 === 0;
    const name = isMale ? male[(i / 2) % male.length] : female[((i - 1) / 2) % female.length];
    const yr = between(1950, 2020);
    const p = await mk('patients', {
      name, gender: isMale ? 'Male' : 'Female', dob: `${yr}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`, bloodGroup: pick(bgs),
      phone: `+88017${between(10000000, 99999999)}`, email: `${name.split(' ')[0].toLowerCase()}${i}@example.com`, address: `House ${between(1, 90)}, Road ${between(1, 20)}`,
      city: pick(cities), maritalStatus: yr > 2005 ? 'Single' : pick(['Single', 'Married', 'Married']), emergencyName: pick(male), emergencyPhone: `+88018${between(10000000, 99999999)}`,
      emergencyRelation: pick(['Spouse', 'Son', 'Brother', 'Father']), allergies: i % 5 === 0 ? ['Penicillin'] : i % 7 === 0 ? ['Dust', 'Peanuts'] : [],
      chronicConditions: i % 4 === 1 ? ['Hypertension'] : i % 6 === 0 ? ['Type 2 Diabetes'] : [], insuranceProvider: i % 6 === 2 ? id(pick(insurers)) : undefined, insuranceNo: i % 6 === 2 ? `INS-${between(10000, 99999)}` : undefined,
      status: 'Active',
    });
    if (p) patients.push(p);
  }
  log(`${patients.length} patients`);

  // ── appointments (history + upcoming) ──
  const times = ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '11:00', '11:30', '12:00', '14:00', '14:30', '15:00', '15:30', '16:00'];
  const used = new Set();
  const complaints = ['Fever and body ache for 3 days', 'Persistent cough and sore throat', 'Chest pain on exertion', 'Stomach pain and acidity', 'Skin rash and itching', 'Lower back pain', 'Headache and dizziness', 'Routine checkup', 'Follow-up visit', 'Ear pain'];
  const appts = [];
  async function book(offset, status) {
    if (!doctors.length || !patients.length) return null;
    const dr = pick(doctors); const pt = pick(patients);
    const date = workday(offset);
    let time = pick(times); let guard = 0;
    while (used.has(`${dr._id}|${date}|${time}`) && guard < 40) { time = pick(times); guard += 1; }
    used.add(`${dr._id}|${date}|${time}`);
    const a = await mk('appointments', { patient: id(pt), doctor: id(dr), date, time, type: pick(['Consultation', 'Consultation', 'Follow-up', 'Checkup']), status, reason: pick(complaints), fee: dr.fee });
    if (a) appts.push({ rec: a, dr, pt });
    return a;
  }
  for (let i = 0; i < 28; i += 1) await book(-between(1, 25), 'Completed');
  for (let i = 0; i < 3; i += 1) await book(-between(1, 10), 'Cancelled');
  await book(-2, 'No-show');
  for (let i = 0; i < 6; i += 1) await book(0, pick(['Scheduled', 'Confirmed', 'Confirmed']));
  for (let i = 0; i < 10; i += 1) await book(between(1, 6), pick(['Scheduled', 'Confirmed']));
  log(`${appts.length} appointments`);

  // ── consultations, vitals, prescriptions ──
  const dx = [['Viral fever', 'R50.9'], ['Acute pharyngitis', 'J02.9'], ['Gastritis', 'K29.7'], ['Essential hypertension', 'I10'], ['Type 2 diabetes mellitus', 'E11.9'], ['Low back pain', 'M54.5'], ['Migraine', 'G43.9'], ['Urinary tract infection', 'N39.0']];
  const completed = appts.filter((a) => a.rec.status === 'Completed');
  let nCons = 0; let nRx = 0;
  for (const { rec, dr, pt } of completed.slice(0, 18)) {
    const [dxName, icdCode] = pick(dx);
    const icdRec = icdRecs.find((x) => x && x.icd === icdCode);
    const dateStr = ymd(rec.date);
    await mk('consultations', {
      patient: id(pt), doctor: id(dr), appointment: id(rec), date: dateStr, chiefComplaint: rec.reason || 'General complaint', history: 'Symptoms started a few days ago; no significant past surgical history.',
      examination: 'General condition fair. Vitals stable.', diagnosis: dxName, icd: id(icdRec), treatmentPlan: 'Medication as prescribed, adequate rest and fluids.', advice: 'Drink plenty of water. Return if symptoms worsen.',
      followUpDate: nCons % 3 === 0 ? ymd(addDays(new Date(dateStr), 7)) : undefined,
    });
    nCons += 1;
    const items = [pick(['Napa 500', 'Napa Extend', 'Ace Plus']), pick(['Seclo 20', 'Maxpro 20', 'Losectil 20']), pick(['Azithro 500', 'Cef-3', 'Fexo 120', 'Calbo-D'])]
      .map((n, i) => ({ medicine: id(med(n)), medicineName: n, dosage: '1 tablet', frequency: i === 0 ? '1+1+1' : '1+0+1', duration: `${pick([3, 5, 7])} days`, quantity: between(6, 20), instructions: i === 1 ? 'Empty stomach' : 'After meal' }));
    const rx = await mk('prescriptions', { patient: id(pt), doctor: id(dr), appointment: id(rec), date: dateStr, diagnosis: dxName, items, advice: 'Take rest. Avoid oily and spicy food.' });
    if (rx) nRx += 1;
  }
  for (const pt of patients.slice(0, 12)) {
    for (let k = 0; k < 2; k += 1) {
      const sys = between(105, 160); const dia = between(65, 100); const h = between(150, 182);
      await mk('vitals', {
        patient: id(pt), recordedAt: new Date(addDays(today, -between(0, 20)).getTime() + between(9, 16) * 3600000).toISOString(), systolic: sys, diastolic: dia, pulse: between(62, 104),
        temperature: Number((97 + rnd() * 3).toFixed(1)), spo2: between(94, 99), weight: between(48, 92), height: h, bloodSugar: between(80, 190), respiratoryRate: between(14, 20),
      });
    }
  }
  log(`${nCons} consultations, ${nRx} prescriptions, 24 vitals records`);

  // ── lab orders ──
  const labOrders = [];
  for (let i = 0; i < 9; i += 1) {
    const chosen = [pick(labTests), pick(labTests)].filter(Boolean);
    const o = await mk('labOrders', { patient: id(pick(patients)), doctor: id(pick(doctors)), orderDate: day(-between(0, 8)), priority: pick(['Routine', 'Routine', 'Urgent']), items: chosen.map((t) => ({ test: id(t) })) });
    if (o) labOrders.push(o);
  }
  for (const [i, o] of labOrders.entries()) {
    try {
      if (i % 3 === 0) await runAction('labOrders', o._id, 'collect', {}, admin, {});
      if (i % 3 === 1) { await runAction('labOrders', o._id, 'collect', {}, admin, {}); await runAction('labOrders', o._id, 'process', {}, admin, {}); }
    } catch (e) { warnings.push(`labOrders action: ${e.message}`); }
  }
  log(`${labOrders.length} lab orders`);

  // ── invoices & payments ──
  const invoices = [];
  for (let i = 0; i < 20; i += 1) {
    const lines = [{ description: pick(services)[0], quantity: 1, unitPrice: pick([500, 1000, 1200, 1500]) }];
    if (i % 3 === 0) lines.push({ description: 'ECG', quantity: 1, unitPrice: 400 });
    if (i % 4 === 0) lines.push({ description: 'Injection (IM/IV) charge', quantity: between(1, 3), unitPrice: 100 });
    const inv = await mk('invoices', { patient: id(pick(patients)), invoiceDate: day(-between(0, 25)), items: lines, discount: i % 5 === 0 ? 100 : 0 });
    if (inv) invoices.push(inv);
  }
  for (const [i, inv] of invoices.entries()) {
    try {
      if (i % 4 === 3) continue; // leave unpaid
      const amount = i % 4 === 2 ? Math.round(inv.total / 2) : inv.total;
      await runAction('invoices', inv._id, 'addPayment', { amount, method: pick(['Cash', 'Cash', 'Card', 'Mobile Banking']), date: inv.invoiceDate }, admin, {});
    } catch (e) { warnings.push(`payment: ${e.message}`); }
  }
  log(`${invoices.length} invoices with payments`);

  // ── admissions ──
  const freeBeds = beds.filter(Boolean);
  const admPts = patients.slice(14, 17);
  for (const [i, pt] of admPts.entries()) {
    await mk('admissions', {
      patient: id(pt), doctor: id(pick(doctors)), bed: id(freeBeds[i * 5]), admitDate: new Date(addDays(today, -(i + 1)).getTime() + 10 * 3600000).toISOString(),
      reason: pick(['Dengue fever – monitoring', 'Acute gastroenteritis', 'Post-operative care']), diagnosis: 'Under evaluation', expectedDischarge: day(3 - i),
    });
  }
  log(`${admPts.length} admissions`);

  // ── OPD queue for today ──
  for (const [i, pt] of patients.slice(0, 5).entries()) {
    await mk('queue', { patient: id(pt), doctor: id(doctors[i % Math.max(1, doctors.length)]), date: day(0), priority: i === 3 ? 'Priority' : 'Normal', status: i === 0 ? 'In-consultation' : 'Waiting' });
  }

  // ── staff, expenses, announcements, ambulances ──
  const staffDefs = [['Rina Akter', 'Nurse', 28000], ['Sumaiya Rahman', 'Nurse', 26000], ['Abul Kalam', 'Receptionist', 22000], ['Hasan Mahmud', 'Pharmacist', 30000], ['Sakib Hossain', 'Lab Technician', 27000], ['Nazrul Islam', 'Accountant', 35000], ['Jamal Uddin', 'Ward Boy', 15000], ['Rahima Begum', 'Cleaner', 12000]];
  for (const [name, designation, salary] of staffDefs) await mk('staff', { name, designation, salary, phone: `+88019${between(10000000, 99999999)}`, joinDate: day(-between(100, 1500)), status: 'Active', gender: designation === 'Nurse' || name.endsWith('Begum') ? 'Female' : 'Male' });
  for (const [title, category, amount] of [['Clinic rent', 'Rent', 85000], ['Electricity bill', 'Utilities', 18500], ['Medical supplies', 'Supplies', 42000], ['Equipment maintenance', 'Maintenance', 9500], ['Facebook page ads', 'Marketing', 6000]]) {
    await mk('expenses', { title, category, amount, date: day(-between(1, 25)), paymentMethod: 'Bank Transfer', paidTo: 'Vendor' });
  }
  await mk('announcements', { title: 'Welcome to MediDesk', body: 'All departments should use MediDesk for appointments, billing and pharmacy from today.', priority: 'Important', audience: 'All', publishDate: day(0), active: true });
  await mk('announcements', { title: 'Friday schedule', body: 'The OPD remains closed on Fridays. Emergency services are available 24/7.', priority: 'Info', audience: 'All', publishDate: day(0), active: true });
  await mk('ambulances', { vehicleNo: 'DHAKA-METRO-HA-12-3456', type: 'BLS', driverName: 'Rafiq', driverPhone: '+8801711000111', status: 'Available' });
  await mk('ambulances', { vehicleNo: 'DHAKA-METRO-HA-11-7788', type: 'ALS', driverName: 'Shamim', driverPhone: '+8801711000222', status: 'Available' });
  log('staff, expenses, announcements, ambulances');

  console.log('\nSeed complete.');
  if (warnings.length) {
    console.log(`\n${warnings.length} non-fatal warning(s) (usually a validation rule on a demo row):`);
    [...new Set(warnings)].slice(0, 15).forEach((w) => console.log(`  ! ${w}`));
  }
  console.log('\nLogin accounts:');
  console.log('  admin@medidesk.com      / Admin@123   (admin)');
  console.log('  doctor@medidesk.com     / Pass@123    (doctor)');
  console.log('  reception@medidesk.com  / Pass@123    (receptionist)');
  console.log('  nurse@ / pharmacy@ / lab@ / accounts@medidesk.com / Pass@123');
  await mongoose.disconnect();
}

main().catch(async (e) => { console.error('Seed failed:', e.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
