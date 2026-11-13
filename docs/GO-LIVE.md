# Going live with a hospital: an honest readiness checklist

This is what is built and tested, what you must configure, and what has not been proven yet. Nothing here is a promise about what was not tested.

## Built and covered by automated tests
Sign-up and 30-day trial, plans and invoices, Razorpay links and webhooks (tested with a fake gateway), multi-branch with per-branch scoping, roles, personal
exceptions and policies (all editable in Settings), doctor schedules and race-safe slot booking, front desk, consultations, signed prescriptions with a
verification QR, documents encrypted at rest, tele-consultation rooms, lab, pharmacy with POS, purchasing, returns, credit and GST bills, reports, tasks,
audit trail, scan-driven check-in, patient and medicine import, rate limiting on sign-in. 111 API tests, run against a real PostgreSQL with row-level security.

## You must set up before the first patient
1. **Hosting and database.** PostgreSQL with automated daily backups and a tested restore. `pnpm db:migrate:deploy` on every release. Run the API with the
   `hms_app` role only (never the owner role). Put the API behind HTTPS and a reverse proxy; set `CORS_ORIGINS`.
2. **Secrets** (`apps/api/.env`): `JWT_SECRET` (32+ chars), `DOCUMENTS_KEY` (64 hex), `DOCUMENTS_DIR` on a backed-up disk, `PUBLIC_WEB_URL`, `NODE_ENV=production`.
3. **Messaging.** `MESSAGING_PROVIDER=webhook` with your SMS/WhatsApp gateway (the console provider sends nothing; production refuses to start with it).
   Without this, OTP sign-in for patients and every reminder fail.
4. **Payments.** `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET`. Test the whole flow in Razorpay's sandbox first: the gateway call is written from their documentation and
   has only been exercised against a fake.
5. **Video.** A Jitsi server of your own with JWT (`TELE_BASE_URL`, `TELE_JWT_APP_ID`, `TELE_JWT_SECRET`). The public service is for demos only.
6. **Hardware.** Any USB or Bluetooth barcode scanner that types like a keyboard (the default mode of almost all of them) works with no setup. A 58/80 mm
   thermal printer set as the browser's default printer prints receipts, slips and labels. Use Chrome or Edge on the desk PCs.
7. **Run the workers** (`apps/worker`): message delivery and reminders, and the monthly invoice and suspension jobs.

## Not proven, so do these before relying on it
- **Load.** Nothing has been load tested. Try a realistic day (a few hundred check-ins, a busy counter) on staging and watch the database.
- **Real devices.** The phone camera scanner, mobile apps and live video have been type-checked and bundled but not exercised on real phones.
- **Real browsers and printers.** Receipts, slips and 2x1 inch labels were rendered to images and reviewed; print them on your actual printers and adjust paper sizes.
- **Accessibility.** The interface has focus handling, labels, keyboard shortcuts, dark mode and larger text, but has not had an audit with a screen reader.
- **Security review.** A penetration test and an independent review of the row-level-security and access-control layers are still advisable before holding real patient data.
- **Compliance.** Consent records, data-retention policy, a privacy notice, and the obligations that come with India's DPDP Act, the hospital's own registrations
  (clinical establishment, drug licence, GST) are business and legal tasks this software supports but does not replace.
- **Monitoring and on-call.** Add error reporting, uptime checks and log retention. There is a `/health` endpoint for the checks.

## Training the first day
Give the desk a printed card: scan the token slip, wristband or health card to check in; `Ctrl K` (or `/`) to search anything; `F2 F4 F6 F7 F8 F9` at the
pharmacy counter. Run one real morning in parallel with the old system before switching over.


## Gaps a large hospital will raise

Not built, in rough order of how soon a buyer asks:

1. Single sign-on for hospital groups (two-step sign-in with authenticator apps is built).
2. ABDM gateway integration (HIP/HIU, consent, health-record linking). Only ABHA capture exists.
3. E-mailed delivery of scheduled reports and a native Excel (.xlsx) format; reports are CSV and held in the app.
4. Insurer integrations (electronic pre-authorisation submission, NHCX). Claims are tracked by staff, not sent.
5. Anaesthesia charts, surgical safety checklists and implant tracking in the theatre record.
6. Payroll: attendance and leave are recorded, but salary calculation is not.
7. Offline mode for the pharmacy counter.
8. A clinical scribe and summary assistant (needs a model provider and clinical review).
9. Real-device and load testing.

Operational notes: the failed-second-step lockout is held in memory per server process, so run a single API instance or move it to a shared store before scaling out; the staff-security cache refreshes within 15 seconds.
