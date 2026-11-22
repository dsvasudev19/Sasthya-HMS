export interface Icd10Code {
  code: string;
  description: string;
  category: string;
}

export const COMMON_ICD10_CODES: Icd10Code[] = [
  // Infectious & General
  { code: 'R50.9', description: 'Fever, unspecified', category: 'General' },
  { code: 'A09', description: 'Infectious gastroenteritis and colitis, unspecified', category: 'Infectious' },
  { code: 'A90', description: 'Dengue fever', category: 'Infectious' },
  { code: 'A01.0', description: 'Typhoid fever', category: 'Infectious' },
  { code: 'B34.9', description: 'Viral infection, unspecified', category: 'Infectious' },
  { code: 'R53.83', description: 'Other fatigue / Generalized weakness', category: 'General' },
  
  // Respiratory
  { code: 'J06.9', description: 'Acute upper respiratory infection, unspecified', category: 'Respiratory' },
  { code: 'J00', description: 'Acute nasopharyngitis (common cold)', category: 'Respiratory' },
  { code: 'J02.9', description: 'Acute pharyngitis, unspecified (sore throat)', category: 'Respiratory' },
  { code: 'J20.9', description: 'Acute bronchitis, unspecified', category: 'Respiratory' },
  { code: 'J45.909', description: 'Unspecified asthma, uncomplicated', category: 'Respiratory' },
  { code: 'J44.9', description: 'Chronic obstructive pulmonary disease, unspecified (COPD)', category: 'Respiratory' },
  { code: 'J18.9', description: 'Pneumonia, unspecified organism', category: 'Respiratory' },
  { code: 'J30.9', description: 'Allergic rhinitis, unspecified', category: 'Respiratory' },

  // Cardiovascular
  { code: 'I10', description: 'Essential (primary) hypertension', category: 'Cardiovascular' },
  { code: 'I25.10', description: 'Atherosclerotic heart disease without angina', category: 'Cardiovascular' },
  { code: 'I20.9', description: 'Angina pectoris, unspecified', category: 'Cardiovascular' },
  { code: 'I50.9', description: 'Heart failure, unspecified', category: 'Cardiovascular' },

  // Endocrine & Metabolic
  { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications', category: 'Endocrine' },
  { code: 'E11.65', description: 'Type 2 diabetes mellitus with hyperglycemia', category: 'Endocrine' },
  { code: 'E10.9', description: 'Type 1 diabetes mellitus without complications', category: 'Endocrine' },
  { code: 'E03.9', description: 'Hypothyroidism, unspecified', category: 'Endocrine' },
  { code: 'E78.5', description: 'Hyperlipidemia, unspecified', category: 'Endocrine' },
  { code: 'E66.9', description: 'Obesity, unspecified', category: 'Endocrine' },

  // Gastrointestinal
  { code: 'K29.70', description: 'Gastritis, unspecified, without bleeding', category: 'Gastrointestinal' },
  { code: 'K21.9', description: 'Gastro-esophageal reflux disease (GERD)', category: 'Gastrointestinal' },
  { code: 'K30', description: 'Functional dyspepsia', category: 'Gastrointestinal' },
  { code: 'K58.9', description: 'Irritable bowel syndrome without diarrhea', category: 'Gastrointestinal' },
  { code: 'K59.00', description: 'Constipation, unspecified', category: 'Gastrointestinal' },
  { code: 'K76.0', description: 'Fatty (change of) liver, not elsewhere classified', category: 'Gastrointestinal' },

  // Neurological & Head
  { code: 'R51', description: 'Headache, unspecified', category: 'Neurological' },
  { code: 'G43.909', description: 'Migraine, unspecified, not intractable', category: 'Neurological' },
  { code: 'G44.209', description: 'Tension-type headache, unspecified', category: 'Neurological' },
  { code: 'R42', description: 'Dizziness and giddiness (Vertigo)', category: 'Neurological' },

  // Musculoskeletal
  { code: 'M54.5', description: 'Low back pain', category: 'Musculoskeletal' },
  { code: 'M54.2', description: 'Cervicalgia (Neck pain)', category: 'Musculoskeletal' },
  { code: 'M17.9', description: 'Osteoarthritis of knee, unspecified', category: 'Musculoskeletal' },
  { code: 'M79.1', description: 'Myalgia (Muscle pain)', category: 'Musculoskeletal' },
  { code: 'M25.50', description: 'Pain in unspecified joint (Arthralgia)', category: 'Musculoskeletal' },

  // Renal & Genitourinary
  { code: 'N39.0', description: 'Urinary tract infection, site not specified (UTI)', category: 'Genitourinary' },
  { code: 'N20.1', description: 'Calculus of ureter / Kidney stone', category: 'Genitourinary' },
  { code: 'N18.9', description: 'Chronic kidney disease, unspecified (CKD)', category: 'Genitourinary' },

  // Dermatology
  { code: 'L30.9', description: 'Dermatitis, unspecified (Eczema)', category: 'Dermatology' },
  { code: 'L50.9', description: 'Urticaria, unspecified', category: 'Dermatology' },
  { code: 'B35.9', description: 'Dermatophytosis (Tinea / Fungal infection)', category: 'Dermatology' },
  { code: 'L70.0', description: 'Acne vulgaris', category: 'Dermatology' },

  // Hematology & Others
  { code: 'D50.9', description: 'Iron deficiency anemia, unspecified', category: 'Hematology' },
  { code: 'H10.9', description: 'Unspecified conjunctivitis', category: 'Ophthalmology' },
  { code: 'H66.90', description: 'Otitis media, unspecified', category: 'ENT' },
  { code: 'Z00.00', description: 'Encounter for general adult medical examination', category: 'Preventive' },
];

export interface ClinicalTemplate {
  name: string;
  complaints: string;
  diagnosis: string;
  advice: string;
}

export const CLINICAL_TEMPLATES: ClinicalTemplate[] = [
  {
    name: 'Acute Febrile Illness',
    complaints: 'High grade fever with chills and rigors x 3 days. Generalized bodyache, headache, and loss of appetite.',
    diagnosis: 'R50.9 - Acute febrile illness (evaluating viral/bacterial etiology)',
    advice: '1. Adequate oral fluid intake (water, ORS, soups).\n2. Light, non-spicy diet.\n3. Cold sponging if temperature > 101°F.\n4. Complete bed rest.\n5. Review SOS or in 48 hours with CBC & Dengue/Malaria screen if fever persists.',
  },
  {
    name: 'Common Cold / URTI',
    complaints: 'Nasal congestion, rhinorrhea, throat irritation, frequent sneezing, dry cough x 2 days.',
    diagnosis: 'J06.9 - Acute upper respiratory tract infection (URTI)',
    advice: '1. Steam inhalation 2-3 times daily.\n2. Warm saline gargles.\n3. Hydration with warm liquids.\n4. Avoid chilled items and dust exposure.\n5. Review in 5 days if symptoms do not resolve.',
  },
  {
    name: 'Acute Dyspepsia / Acidity',
    complaints: 'Epigastric burning, retrosternal heartburn, acid reflux, postprandial bloating and mild nausea x 4 days.',
    diagnosis: 'K21.9 - Gastro-esophageal reflux disease / Dyspepsia',
    advice: '1. Take frequent small meals, avoid heavy oily or spicy food.\n2. Do not lie down immediately after meals (wait 2 hours).\n3. Elevate head end of bed.\n4. Avoid tea, coffee, carbonated drinks, and smoking.\n5. Review in 2 weeks.',
  },
  {
    name: 'Hypertension Follow-Up',
    complaints: 'Regular follow-up visit for known hypertension. Asymptomatic today; denies headache, chest pain, palpitations, or visual changes.',
    diagnosis: 'I10 - Essential (primary) hypertension on medical management',
    advice: '1. Continue prescribed anti-hypertensive medication without missing doses.\n2. Low salt diet (< 5g/day), reduce dietary saturated fat.\n3. Daily 30-40 min moderate aerobic exercise (brisk walk).\n4. Maintain home BP log (weekly twice).\n5. Review in 1 month with Serum Creatinine and Lipid Profile.',
  },
  {
    name: 'Type 2 Diabetes Review',
    complaints: 'Follow-up for glycemic monitoring in Type 2 Diabetes Mellitus. No polyuria, polydipsia, foot ulcers, or tingling/numbness.',
    diagnosis: 'E11.9 - Type 2 diabetes mellitus under regular surveillance',
    advice: '1. Strict diabetic diet (avoid refined sugars, sweets, fruit juices; emphasize fiber).\n2. Regular foot inspection and comfortable footwear.\n3. 30 minutes daily physical activity.\n4. Self-monitor blood glucose (FBS / PPBS alternate days).\n5. Check HbA1c, urine microalbumin every 3-6 months.',
  },
  {
    name: 'Acute Gastroenteritis',
    complaints: 'Multiple episodes of watery loose stools, abdominal cramping, and nausea x 1 day. Mild dehydration.',
    diagnosis: 'A09 - Acute infectious gastroenteritis',
    advice: '1. Drink ORS (Oral Rehydration Solution) 1 glass after every loose stool.\n2. Coconut water, buttermilk, light rice gruel (khichdi/curd rice).\n3. Strict hand hygiene before eating.\n4. Avoid milk products and spicy foods.\n5. Report immediately if blood in stool, persistent vomiting, or extreme lethargy.',
  },
  {
    name: 'Low Back Pain',
    complaints: 'Dull aching lower back pain aggravated by prolonged sitting and forward bending x 1 week. No radiating pain to lower limbs.',
    diagnosis: 'M54.5 - Mechanical low back strain',
    advice: '1. Avoid heavy lifting and forward stooping.\n2. Hot fomentation to lower back for 15 mins twice daily.\n3. Ergonomic chair support; take walking breaks every 45 mins.\n4. Back-strengthening (core) physiotherapy once acute pain subsides.\n5. Review in 10 days.',
  },
];

export const QUICK_DOSES = ['1 tab', '1 cap', '5 ml', '10 ml', '1 puff', '1 sachet', 'Apply thin layer'];
export const QUICK_INSTRUCTIONS = ['After food', 'Before food', 'At bedtime', 'With warm water', 'Empty stomach (morning)', 'SOS (when needed)'];
