export interface InpatientPreset {
  title: string;
  category: 'ROUND' | 'ORDER';
  text: string;
}

export const DOCTOR_ROUND_TEMPLATES = [
  {
    title: 'Post-Op Day 1',
    text: 'Patient conscious, oriented. Afebrile. Vitals stable (BP, HR, SpO2 within normal limits). Surgical site dressing clean, dry, and intact. Mild pain managed with analgesics. Tolerating sips of liquids. Plan: Ambulate with support, continue IV antibiotics, step down to oral analgesics.',
  },
  {
    title: 'Post-Op Day 2',
    text: 'Patient ambulating comfortably. Afebrile x 48 hrs. Good bowel sounds, passed flatus. Surgical wound clean. Tolerating soft diet. Plan: Discontinue IV cannula, switch to oral medications. Plan discharge tomorrow morning.',
  },
  {
    title: 'Medical Recovery',
    text: 'Symptoms improving. Dehydration corrected, hemodynamically stable. Respiratory rate and SpO2 normal on room air. Lab parameters reviewed. Plan: Complete course of oral medications, taper IV fluids.',
  },
  {
    title: 'ICU / High Dependency Step-Down',
    text: 'Cardiovascular and respiratory status stable. Weaned off supplemental oxygen. Urine output adequate (> 0.5 ml/kg/hr). Sensorium clear. Plan: Transfer to step-down/general ward today.',
  },
];

export const INPATIENT_ORDER_PRESETS = [
  'Inj. Ceftriaxone 1g IV in 100ml NS twice daily (BD)',
  'Inj. Pantoprazole 40mg IV once daily (OD) before breakfast',
  'Inj. Paracetamol 1g IV slow infusion SOS (for fever > 100°F or severe pain)',
  'Inj. Ondansetron 4mg IV SOS for nausea/vomiting',
  'IV DNS 500ml @ 75 ml/hr x 2 pints',
  'IV Ringer Lactate (RL) 500ml @ 100 ml/hr',
  'Strict Input / Output (I/O) fluid chart monitoring every 4 hours',
  'Vital signs monitoring (Pulse, BP, SpO2, Temp) every 2 hours',
  'Nebulization with Levosalbutamol + Budecort every 6 hours',
  'Daily fasting blood sugar (FBS) & post-prandial blood sugar (PPBS)',
  'Cardiac monitor & continuous pulse oximetry',
];

export const ER_INTERVENTION_PRESETS = [
  'Wide-bore IV line secured (18G). Normal Saline 500ml IV bolus started stat.',
  'High-flow Oxygen administered via non-rebreather mask @ 8 L/min.',
  '12-lead Electrocardiogram (ECG) performed stat - reviewed by ER physician.',
  'Inj. Paracetamol 1g IV infusion given for severe pyrexia.',
  'Inj. Ondansetron 4mg IV given for persistent vomiting.',
  'Inj. Tramadol 50mg in 100ml NS slow IV given for acute trauma pain.',
  'Nebulization with Duolin (Levosalbutamol + Ipratropium) given stat.',
  'Blood drawn for STAT emergency workup: CBC, Blood Gas (ABG), Electrolytes, Cardiac Troponin.',
  'Wound irrigation with normal saline, antiseptic cleaning, and sterile compression dressing applied.',
  'Patient stabilized in resuscitation bay. Monitored continuously.',
];
