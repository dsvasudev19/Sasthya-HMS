# Healthcare Regulatory Compliance Architecture & Roadmap

This document outlines the healthcare regulatory compliance architecture, statutory requirements, implementation status, and operational guidelines for the **Swasthya HMS** platform.

---

## 1. Regulatory Frameworks & Applicability

Swasthya HMS is designed to support clinical establishments, hospitals, nursing homes, diagnostic laboratories, and pharmacies. The platform adheres to the following primary regulatory frameworks:

| Regulation / Standard | Jurisdiction | Governing Body | Core Focus |
|---|---|---|---|
| **HIPAA** (Health Insurance Portability & Accountability Act) | United States / International Benchmark | HHS / OCR | Security Rule (Administrative, Physical, Technical safeguards), Privacy Rule (ePHI handling, Minimum Necessary), Breach Notification. |
| **ABDM** (Ayushman Bharat Digital Mission) | India | National Health Authority (NHA) | Digital health ecosystem: ABHA generation, HFR/HPR registries, FHIR R4 data exchange, HIP/HIU consent flow (M1, M2, M3). |
| **DPDP Act 2023** (Digital Personal Data Protection Act) | India | Data Protection Board of India | Data Fiduciary obligations, itemized notice & consent, data principal rights (access, correction, erasure), DPO appointment. |
| **MoHFW EHR Standards (2016)** | India | Ministry of Health & Family Welfare | Electronic health record interoperability, SNOMED-CT, LOINC, ICD-10/11, clinical record retention periods. |
| **Telemedicine Practice Guidelines (2020)** | India | National Medical Commission (NMC) | Patient consent protocols, RMP validation, drug scheduling classifications, digital prescription signing. |
| **Clinical Establishments Act & State Rules** | India | State Health Authorities | Clinical governance, pricing transparency, medical record maintenance. |

---

## 2. Technical Safeguards & Implementation Status

### A. Access Control & Identity Security (HIPAA § 164.312(a)(1), DPDP § 8)
- **Unique User Credentials**: Every staff member, clinician, and operator has a unique identity. No shared accounts.
- **Strong Credential Hashing**: Password hashing using Scrypt with cryptographic salt (`@hms/auth`).
- **Two-Factor Authentication (MFA / 2FA)**: Time-based One-Time Passwords (TOTP RFC 6238) supported for all accounts, with tenant-level enforcement policies (`require_2fa` in `tenant_security`).
- **Workstation Auto-Logoff (HIPAA § 164.312(a)(2)(iii))**:
  - Web admin and platform portals enforce an automatic 15-minute inactivity timeout.
  - Active event listeners (`mousemove`, `keydown`, `scroll`, `touchstart`) detect idle workstations and terminate sessions, redirecting to login with a compliance notice.
- **Emergency Access / Break-Glass Mode (HIPAA § 164.312(a)(2)(ii))**:
  - In life-threatening emergencies, clinician access can be temporarily elevated with mandatory justification recorded into the immutable audit trail.

### B. Audit Controls & Accountability (HIPAA § 164.312(b), MoHFW EHR § 4)
- **Immutable Audit Trails**:
  - Hospital-level audit logs (`hms.audit_logs`) and platform operator audit logs (`platform.platform_audit`).
  - Database-enforced append-only guarantee: `REVOKE UPDATE, DELETE ON "hms"."audit_logs" FROM "hms_app";`
- **Logged Actions**:
  - Medical records viewed, consultations created/edited.
  - Diagnostic test releases, scanned document downloads.
  - Signed prescription prints and QR verifications.
  - Financial transactions, fee modifications, and patient data exports.

### C. Data Encryption & Transmission Security (HIPAA § 164.312(e), DPDP § 8)
- **Data at Rest**:
  - Patient clinical documents, scans, and attachments are stored encrypted using AES-256-GCM (`LocalFileStore` with 256-bit symmetric key).
  - Database volume encryption (LUKS / AWS EBS KMS / GCP CMEK).
- **Data in Transit**:
  - Enforced TLS 1.3 across all HTTP endpoints with HTTP Strict Transport Security (HSTS).
  - WebSockets / WebRTC teleconsultation connections encrypted via DTLS-SRTP.

### D. Multi-Tenancy & Data Isolation (HIPAA § 164.308, DPDP)
- **PostgreSQL Row-Level Security (RLS)**:
  - Every tenant's data in the `hms` schema is guarded by PostgreSQL RLS policies (`current_setting('app.tenant_id')`).
  - The application database user (`hms_app`) cannot bypass RLS. Cross-tenant leakage is prevented at the kernel/database layer.

---

## 3. ABDM (Ayushman Bharat Digital Mission) Compliance

Swasthya HMS aligns with the National Health Authority (NHA) ABDM architecture across three milestones:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ABDM COMPLIANCE PHASES                          │
├─────────────────────┬──────────────────────────┬───────────────────────┤
│    MILESTONE 1      │       MILESTONE 2        │      MILESTONE 3      │
│  ABHA Creation &    │   HFR & HPR Registries   │ FHIR Health Exchange  │
│    Verification     │   HIP/HIU Record Linking │  & Consent Gateway    │
├─────────────────────┼──────────────────────────┼───────────────────────┤
│ • 14-digit ABHA No  │ • Hospital HFR Mapping   │ • Consent Artifacts   │
│ • ABHA Address      │ • Doctor HPR Mapping     │ • FHIR R4 Bundles:    │
│   (name@abdm)       │ • Patient Discovery      │   - OP Consultation   │
│ • OTP Verification  │ • Link Care Context      │   - Diagnostic Report │
│ • Demographics sync │ • Care Context Notify    │   - Discharge Summary │
└─────────────────────┴──────────────────────────┴───────────────────────┘
```

1. **Milestone 1 (M1) - ABHA Number & Address**:
   - `patients.abha_number` (14-digit format: `12-3456-7890-1234`) and `patients.abha_address` (`name@abdm`) are captured and validated during patient registration and check-in.
   - OTP validation interfaces connect to the ABDM gateway.
2. **Milestone 2 (M2) - HFR & HPR Registration**:
   - Hospital legal profile stores National Health Facility Registry (HFR) identifier.
   - Doctor profiles store National Healthcare Professional Registry (HPR) identifier and state medical council registration numbers.
3. **Milestone 3 (M3) - Standard FHIR R4 Health Data Exchange**:
   - Diagnostic reports, prescriptions, and discharge summaries formatted as HL7 FHIR Release 4 bundles adhering to NRCeS (National Resource Centre for EHR Standards) profiles.

---

## 4. DPDP Act 2023 & GDPR Compliance

### Notice & Itemized Consent
- When registering patients, an explicit Privacy Notice must be presented informing the patient of:
  - Categories of personal data collected (demographics, vital signs, clinical notes, diagnostic imaging).
  - Specific purposes (clinical treatment, electronic prescription delivery, statutory billing).
  - Data Fiduciary contact and designated Grievance Redressal / Data Protection Officer (DPO).
- Notice is provided in English and local regional languages.

### Medical Record Retention vs. Right to Erasure
Under the DPDP Act and GDPR, individuals have a "Right to Erasure" (deletion of personal data). **However, in healthcare, statutory clinical retention laws take precedence**:
- **Statutory Retention Schedule (MoHFW EHR Standards & NMC Regulations)**:
  - **Adult Outpatient Records (OPD)**: Minimum **3 years** from visit date.
  - **Adult Inpatient Records (IPD), Operation Notes, & Discharge Summaries**: Minimum **10 years** (recommended permanent digital archive).
  - **Medico-Legal Cases (MLC)**: Permanent / until court disposal.
  - **Pediatric Records**: Retained until the child turns **21 years** (age of majority 18 + 3 years statutory limitation period).
- **Technical Implementation**:
  - Patient deletion requests execute anonymization / pseudonymization of non-clinical data, while clinical records are marked as "ARCHIVED / LEGAL_HOLD" with restricted access, strictly complying with medical regulations.

---

## 5. Telemedicine Practice Guidelines (2020) Compliance

- **Consent**:
  - Patient-initiated video/audio consultation is deemed implied consent for telemedicine.
  - Clinician-initiated teleconsultation requires explicit verbal/written consent recorded in the consultation notes.
- **Clinician Identification**:
  - The doctor's full name, medical qualification, and State/National Medical Council Registration Number are mandatorily printed on electronic prescriptions generated from tele-consultations.
- **Drug Scheduling Compliance**:
  - Prescriptions strictly observe List O (over-the-counter), List A (first consult safe medications), and prohibited List X (narcotics/psychotropics under NDPS Act, prohibited via telemedicine).

---

## 6. Going-Live Compliance Checklist for Hospital Administrators

Before welcoming real patients into the production environment, the hospital administrator and IT compliance team must verify:

- [ ] **Hospital Registrations on Record**: Enter Clinical Establishment Act registration number, Drug Licence (for in-house pharmacy), and GSTIN in Organization Settings.
- [ ] **MFA Enforcement**: Enable "Require 2FA" in Security Settings for all accounts handling sensitive ePHI.
- [ ] **HTTPS & Certificates**: Ensure all traffic is encrypted with TLS 1.3; reverse proxy headers (`X-Forwarded-For`, `Strict-Transport-Security`) configured.
- [ ] **Document Storage Encryption**: Verify `DOCUMENTS_KEY` is a 64-hex AES key stored securely in environment secrets and not committed to code.
- [ ] **Data Processing Agreement (DPA)**: Countersign the DPA and MSA agreements generated during organization onboarding.
- [ ] **Designate Privacy & Grievance Officer**: Provide name, email, and phone number on patient receipts and patient portal terms.
- [ ] **Daily Backups & Disaster Recovery**: Verify automated PostgreSQL backups (WAL-E / pgBackRest) with tested recovery procedure.
- [ ] **Workstation Hygiene**: Ensure all desk terminals use supported modern browsers, enforce automatic screen lock, and restrict USB mass storage.

