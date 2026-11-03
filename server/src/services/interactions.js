// Feature 10: drug-interaction and allergy warnings. Advisory only – it is a small built-in table of
// common, well-known pairs, NOT a complete clinical database. The doctor stays responsible.
import { M } from '../config/registry.js';

const NSAID = ['ibuprofen', 'diclofenac', 'naproxen', 'ketorolac', 'piroxicam', 'indomethacin', 'etoricoxib', 'celecoxib', 'aceclofenac'];
const ACEI_ARB = ['enalapril', 'lisinopril', 'ramipril', 'captopril', 'perindopril', 'losartan', 'valsartan', 'telmisartan', 'irbesartan', 'candesartan', 'olmesartan'];
const SULFONYLUREA = ['glimepiride', 'gliclazide', 'glibenclamide', 'glipizide'];
const SSRI = ['sertraline', 'fluoxetine', 'paroxetine', 'escitalopram', 'citalopram', 'amitriptyline'];
const ANTACID = ['aluminium', 'aluminum', 'magnesium', 'calcium', 'antacid'];

// [groupA, groupB, severity, message]
const PAIRS = [
  [['warfarin'], [...NSAID, 'aspirin', 'ciprofloxacin', 'metronidazole', 'fluconazole', 'azithromycin', 'clarithromycin'], 'high', 'Increased bleeding risk with warfarin'],
  [['aspirin'], NSAID, 'medium', 'Two NSAID/antiplatelet agents together raise GI-bleeding risk'],
  [NSAID, ACEI_ARB, 'medium', 'NSAIDs can blunt ACE-inhibitor/ARB effect and harm kidneys'],
  [ACEI_ARB, ['spironolactone', 'potassium'], 'high', 'Risk of high potassium (hyperkalaemia)'],
  [['simvastatin', 'atorvastatin', 'rosuvastatin'], ['clarithromycin', 'erythromycin', 'itraconazole', 'ketoconazole'], 'high', 'Statin + macrolide/azole: risk of muscle damage (myopathy)'],
  [['ciprofloxacin', 'levofloxacin', 'norfloxacin'], [...ANTACID, 'iron', 'zinc'], 'medium', 'Antacids/minerals reduce fluoroquinolone absorption – separate by 2 hours'],
  [['doxycycline', 'tetracycline'], [...ANTACID, 'iron'], 'medium', 'Antacids/iron reduce tetracycline absorption – separate by 2 hours'],
  [['sildenafil', 'tadalafil'], ['isosorbide', 'nitroglycerin', 'glyceryl', 'nitrate'], 'high', 'PDE5 inhibitor + nitrate: severe hypotension'],
  [['tramadol'], SSRI, 'high', 'Tramadol + antidepressant: serotonin syndrome / seizure risk'],
  [['clopidogrel'], ['omeprazole', 'esomeprazole'], 'medium', 'Omeprazole/esomeprazole can reduce clopidogrel effect (consider pantoprazole)'],
  [['digoxin'], ['amiodarone', 'clarithromycin', 'verapamil', 'erythromycin'], 'high', 'Raises digoxin level – toxicity risk'],
  [['methotrexate'], ['trimethoprim', 'cotrimoxazole', 'co-trimoxazole', ...NSAID], 'high', 'Methotrexate toxicity risk'],
  [['theophylline'], ['ciprofloxacin', 'erythromycin', 'clarithromycin'], 'high', 'Raises theophylline level – toxicity risk'],
  [['lithium'], [...NSAID, ...ACEI_ARB, 'hydrochlorothiazide'], 'high', 'Raises lithium level – toxicity risk'],
  [SULFONYLUREA, ['fluconazole', 'ciprofloxacin', 'cotrimoxazole', 'co-trimoxazole'], 'medium', 'Risk of low blood sugar (hypoglycaemia)'],
  [['levothyroxine'], ['calcium', 'iron', ...ANTACID], 'medium', 'Reduces levothyroxine absorption – separate by 4 hours'],
  [['metformin'], ['contrast'], 'medium', 'Hold metformin around iodinated contrast'],
];

// allergy keyword → drugs it covers
const ALLERGY_CLASS = {
  penicillin: ['penicillin', 'amoxicillin', 'ampicillin', 'cloxacillin', 'flucloxacillin', 'piperacillin', 'amoxiclav', 'co-amoxiclav', 'augmentin'],
  sulfa: ['sulfamethoxazole', 'cotrimoxazole', 'co-trimoxazole', 'sulfasalazine', 'sulfadiazine'],
  nsaid: [...NSAID, 'aspirin', 'mefenamic'],
  aspirin: ['aspirin'],
  cephalosporin: ['cef', 'ceph'],
  macrolide: ['azithromycin', 'clarithromycin', 'erythromycin'],
  quinolone: ['ciprofloxacin', 'levofloxacin', 'norfloxacin', 'ofloxacin', 'moxifloxacin'],
  codeine: ['codeine', 'tramadol', 'morphine'],
};

const hasAny = (text, list) => list.some((k) => text.includes(k));

export async function checkPrescription({ patientId, items = [] }) {
  const warnings = [];
  const ids = items.map((i) => i.medicine).filter(Boolean);
  const meds = ids.length ? await M('medicines').find({ _id: { $in: ids } }).select('name genericName').lean() : [];
  const byId = Object.fromEntries(meds.map((m) => [String(m._id), m]));
  const drugs = items.map((i) => {
    const m = i.medicine ? byId[String(i.medicine)] : null;
    const label = m?.name || i.medicineName || '';
    return { label, text: `${label} ${m?.genericName || ''}`.toLowerCase(), generic: (m?.genericName || '').toLowerCase().trim() };
  }).filter((d) => d.label);

  const patient = patientId ? await M('patients').findById(patientId).select('allergies chronicConditions').lean() : null;
  const allergies = (patient?.allergies || []).map((a) => String(a).toLowerCase().trim()).filter(Boolean);
  for (const d of drugs) {
    for (const a of allergies) {
      const cls = Object.entries(ALLERGY_CLASS).find(([k]) => a.includes(k));
      const direct = d.text.includes(a) || a.includes(d.generic || '\u0000');
      if (direct || (cls && hasAny(d.text, cls[1]))) {
        warnings.push({ severity: 'high', type: 'allergy', message: `${d.label}: patient is allergic to "${a}"` });
        break;
      }
    }
  }
  for (let i = 0; i < drugs.length; i += 1) {
    for (let j = i + 1; j < drugs.length; j += 1) {
      for (const [A, B, severity, msg] of PAIRS) {
        if ((hasAny(drugs[i].text, A) && hasAny(drugs[j].text, B)) || (hasAny(drugs[j].text, A) && hasAny(drugs[i].text, B))) {
          warnings.push({ severity, type: 'interaction', message: `${drugs[i].label} + ${drugs[j].label}: ${msg}` });
        }
      }
      if (drugs[i].generic && drugs[i].generic === drugs[j].generic) {
        warnings.push({ severity: 'medium', type: 'duplicate', message: `${drugs[i].label} and ${drugs[j].label} contain the same generic (${drugs[i].generic})` });
      }
    }
  }
  return warnings;
}