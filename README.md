# Swasthya HMS

Affordable hospital management for rural and small hospitals: appointments, OPD, pharmacy, lab, billing, health cards,
a patient app and a staff app. Hospitals and independent doctors are the **tenants**.

Design document: see the proposal (multi-tenant, shared tables with `tenant_id` + PostgreSQL row-level security).

## Layout

| Path | What |
| --- | --- |
| `apps/api` | Fastify + TypeScript API (tenant-scoped via `withTenant`) |
| `apps/worker` | Background worker: queues reminders and delivers the message outbox with retries |
| `apps/web-admin` | React + Vite + Tailwind: hospital dashboard |
| `apps/web-platform` | React + Vite + Tailwind: Swasthya operator console (hospitals, plans, invoices) |
| `apps/mobile-staff` | Expo (React Native): live queue, check-in, health card QR scan |
| `apps/mobile-patient` | Expo (React Native): phone OTP login, book, live queue token, health cards |
| `packages/db` | Prisma schema, SQL migrations, tenant-scoped client, seed, DB policy check |
| `packages/notifications` | SMS/WhatsApp providers, English and Hindi templates, outbox, reminder scheduler |
| `packages/billing-core` | Plans, feature flags, GST maths, platform invoice computation, payment gateway (Razorpay) |
| `packages/ui-web` | Shared web components (custom Select, popover, modal) and the design tokens |
| `packages/auth` | Password hashing, OTP helpers, token claims, role permissions |
| `packages/contracts` | Zod schemas shared by API and clients |
| `packages/ui-native` | Shared React Native components and theme |
| `packages/mobile-core` | Shared mobile API client and secure token storage |
| `infra/postgres` | One-time role + database bootstrap |

## First-time setup

```bash
pnpm install
pnpm db:bootstrap        # creates roles hms_migrator / hms_app, empty DB swasthya_hms, writes packages/db/.env
grep DATABASE_URL= packages/db/.env > apps/api/.env   # app-role URL for the API (see apps/api/.env.example)
pnpm db:migrate:dev      # applies migrations (platform + hms schemas)
pnpm db:seed             # demo hospital "Sunrise Rural Hospital": staff 9000000001-5 (owner, doctor, reception, pharmacist, lab tech), patients, a health card (password: see packages/db/scripts/seed.ts)
pnpm db:check            # asserts: nothing in public, RLS forced on every hms table, app role cannot bypass RLS
pnpm dev                 # api :4000, web-admin :5173, web-platform :5174
pnpm test                # API tests: tenant isolation, health cards, patient app (needs the local database)
pnpm mobile:staff        # Expo dev server (staff app); pnpm mobile:patient for the patient app
```

Mobile apps call `http://localhost:4000` (iOS simulator, web) or `http://10.0.2.2:4000` (Android emulator). Set
`EXPO_PUBLIC_API_URL` to point at another API. In development the OTP is returned by the API and auto-filled;
the API sends it through the configured messaging provider (see Messaging).

## Health cards

Hospitals sell individual (₹200 card + ₹2,000 for 6 months) and family (₹500 + ₹8,000, up to 5 members) cards. A running
plan covers 3 in-person and 2 tele-consultations per member; coverage is applied at check-in and returned if the visit is
cancelled. Renewal costs only the plan price. Prices and limits are rows in `hms.health_card_plans`, editable per hospital.

## Database rules

- Nothing lives in `public`. Global data is in `platform`, tenant data in `hms`, extensions in `ext`.
- **Every schema change is a SQL migration**: edit `packages/db/prisma/schema.prisma`, run
  `pnpm db:migrate:new <name>`, review/edit the SQL (RLS, grants), commit it, then `pnpm db:migrate:dev`.
  Production uses `pnpm db:migrate:deploy`. Never use `prisma db push` or hand-written DDL.
- Every table in `hms` needs `tenant_id uuid NOT NULL`, `@@unique([tenantId, id])`, and RLS (enable + force +
  `tenant_isolation` policy). `pnpm db:check` fails otherwise.
- The API connects as `hms_app` (DML only, no BYPASSRLS) and runs every request inside `withTenant(db, tenantId, fn)`.
- Migrations run as `hms_migrator`.

## Billing

- Check-in creates the visit's invoice from the hospital's price list (`hms.fee_items`; defaults ₹200 in person, ₹150 tele).
  A card-covered visit shows the fee with a full discount ("Covered by health card") and is marked paid at ₹0.
- Issuing or renewing a health card creates a paid invoice (card fee + plan price, or plan price only).
- Payments are atomic and append-only: the app role cannot edit or delete payments or daily closings, and two cashiers
  cannot overpay an invoice. Invoices cannot be deleted; an unpaid one can be voided by an owner or admin.
- Invoice, patient and daily token numbers come from race-free per-tenant counters (`hms.counters`).
- The owner or an admin closes each day by entering counted cash; the system stores the difference against expected cash.
- Not built yet: refunds, online UPI collection through a payment gateway, GST invoices.

## Clinical, pharmacy and lab

- **Consultation:** a nurse records vitals; the doctor writes complaints, diagnosis, prescription (from the pharmacy catalogue or free
  text), orders lab tests and completes the visit. Completed notes are locked. Completed prescriptions appear at the pharmacy counter.
- **Pharmacy:** medicines with batches and expiry. Dispensing is first-expiry-first-out, never sells expired stock, and row locks stop
  two counters selling the same last units. Every change is in an append-only stock ledger. Alerts for low stock, expiring and expired batches.
- **Lab:** tests with reference and critical ranges. Results are flagged (low, high, critical). A report is released to the patient only
  when its bill is paid, unless an owner or admin overrides (audited). Released reports and prescriptions show in the patient app.
- Roles: owner, admin, doctor, nurse, receptionist, pharmacist, lab technician, each with its own permissions (`packages/auth`).

## Access control: roles, personal exceptions and policies

Everything is configured per hospital in Settings, nothing is fixed in code except the list of things the product can do (the permission catalogue).

- **Roles.** Built-in roles (owner, admin, doctor, nurse, reception, pharmacist, lab technician, pharmacy cashier) are starting points; add your own
  and edit any of them. Nobody can hand out a permission they do not hold themselves.
- **Personal exceptions.** On top of roles, a person can be given a permission for a number of days (covering a colleague's leave) or have one taken
  away (no billing for this nurse). Revokes win over grants, expired grants stop working by themselves, the owner's access cannot be cut and nobody can
  edit their own. The Team tab's shield button shows exactly what a person can do and why (which role, which grant, which revoke).
- **Policies.** Rules that block an action even when a role allows it: a discount cap, refunds above an amount, no stock write-offs at night, a freeze during
  a festival week. A rule can need all of its conditions or any one of them, can exclude roles ("everyone except the owner"), can run only between two dates,
  and can be tried out in the simulator for any moment in time before it is switched on. Conditions can look at amount, discount, quantity, hour, weekday,
  date, branch, the person and their roles.
- **Every change is audited** (Audit trail page): who changed which role, policy, exception, team role or branch, with before and after.
- Menus, buttons and the mobile apps all follow the permissions the server resolves; the server enforces them regardless.

## Pharmacy bills and booking

- **Pharmacy bills.** A sale prints as a GST tax invoice (A4: HSN, batch, expiry, MRP, tax split by rate, amount in words, drug licence number from
  Settings, Hospital profile) or as an 80 mm thermal receipt. The counter prints its own bill (`/pos/sales/:id/receipt.pdf?format=thermal|a4`)
  without needing billing access, and can print automatically after every sale.
- **Booking into real slots.** Staff and patients book a doctor's free slots (taken, past and leave times do not appear); staff with the override
  permission may book outside the schedule. The Appointments page has a day calendar with a column per doctor and clickable free slots, and a list view.
  The patient app picks a branch, a doctor and a real slot.

## Pharmacy extras and appearance

- **Strips and loose units.** A medicine has a pack size and a pack name ("strip of 10"). Stock and price are per unit; the counter sells a whole strip or
  loose tablets per line, and stock shows as "12 strips + 3".
- **Customer credit.** Link a registered customer at the counter and pay less than the total to leave a balance. The Credit page lists who owes what and for
  how long, and a payment is spread over their oldest bills first.
- **Bulk import.** Inventory, Import takes a CSV (template included; column names are matched loosely, MM/YY expiries work, rupees are converted). It checks every
  row first, shows what would be added or updated and which rows have problems, then imports in chunks. Opening stock goes into the branch being viewed.
- **Dark mode** (sun/moon button, follows the device until you choose) and image thumbnails for scanned documents.
- Not included: reading handwriting from scans (OCR). Scanned prescriptions are stored and shown as images; typing the prescription is the supported digital path.

## Scan-first operations and onboarding

- **Scan anything, anywhere.** A handheld scanner (it types fast and presses Enter) or the camera works on every screen with nothing to configure. The same
  code does the obvious thing: a **token slip** or **patient wristband** or **health card** checks the patient in and raises the bill; a **sample label** marks the
  sample collected; a **bill barcode** opens the bill; a **prescription QR** loads it into the pharmacy counter; a **medicine barcode** sells it at the counter or adds a
  line at goods receipt. A short sound and a result card say what happened; walk-ins and "which appointment?" are one tap.
- **Front desk page** keeps the cursor in the scan box, shows who is expected and waiting, and prints the token slip.
- **Print-outs that scan back:** token slip, patient card and 2x1 inch sample labels (Code 128, readable by cheap 1D scanners).
- **Search from anywhere:** `Ctrl K` or `/` opens one box for patients (name, phone, number), bills, lab orders, medicines, documents, pages and actions; typing or scanning a code works there too.
- **Go-live checklist** on the dashboard, computed from the hospital's own data, plus spreadsheet import for patients and medicines. See `docs/GO-LIVE.md` for what is
  built, what you must configure, and what has not been proven yet.

## Dashboard pages

Dashboard (live queue, takings, what needs attention, my tasks), Reports and analytics (revenue, visits, patients, clinical, lab, by branch, CSV), Tasks (with
suggestions found in your data), Audit trail, the notification bell, Documents, Tele-consultations, Pharmacy workspace. `pnpm db:seed:history` fills the demo
hospital with two months of activity so the charts have something to show (local development only).

## Medical record, documents and tele-consultation

- **Full history on every visit.** The consultation screen shows the patient's whole record beside the notes: allergies and long-term
  conditions first (red when there is an allergy), then every visit with its prescription, lab results, medicines bought at the
  pharmacy and every scanned file, plus vitals charted across visits. `GET /patients/:id/history`. Looking at a record is audited.
- **Two ways to get a prescription into the record.** A nurse scans the paper one (camera in the web app or the staff mobile app;
  several pages; it is attached to today's visit and the doctor sees it at once), or the doctor writes it digitally, signs off and
  prints it. Signing numbers it (`RX-MAIN-2026-00001`), freezes it and adds a QR code. The PDF is `GET /consultations/:id/prescription.pdf`
  and the QR opens `/verify/:tenantId/:code`, where a pharmacist can confirm it is genuine (no diagnosis or contact details shown).
- **Documents.** PDF, JPEG, PNG or WebP up to 10 MB, judged by content rather than file name. Files are encrypted at rest
  (AES-256-GCM) and only ever served through the API after a permission check, never from a public URL. The same scan uploaded twice is stored once.
  Records are never hard-deleted: "removing" hides a file, needs a reason and is audited; the app role has no DELETE on the table.
  Patients see files marked visible, and their prescriptions, in the patient app; phones open them through a two-minute single-file link.
- **Tele-consultation.** A tele appointment gets a private video room with an unguessable name. The patient taps Join in the app (open
  from 15 minutes before) and waits; the doctor sees "patient is waiting", starts the call from the consultation screen, the patient is
  sent an SMS once, and the visit continues as a normal consultation with notes and prescription beside the video. Video uses Jitsi:
  set `TELE_BASE_URL` to your own server and `TELE_JWT_APP_ID` / `TELE_JWT_SECRET` to sign join links so only invited people enter and only
  the doctor moderates. Without them it uses the public meet.jit.si, which is fine for trying it out only.
- **Production settings.** `DOCUMENTS_KEY` (64 hex characters, `openssl rand -hex 32`) is required when `NODE_ENV=production`; the API
  refuses to start without it. `DOCUMENTS_DIR` sets where files live (back it up with the database; swap `src/storage.ts` for object
  storage when you outgrow one disk). `PUBLIC_WEB_URL` is the address the prescription QR points at. If the web app is served with a
  Content-Security-Policy, allow `frame-src` for your video host and `camera`/`microphone` in the Permissions-Policy.
- Permissions: `documents:read`, `documents:write`, `tele:conduct` (doctors), all editable per role.

## Messaging

- Messages are queued in the same transaction as the event that causes them (booking, report release) and delivered by `apps/worker`
  with retries (1 min, 5 min, 30 min, then marked failed; failed messages can be retried from the Messages page).
- Automatic messages: booking confirmation, one appointment reminder within 24 h, follow-up reminder, health card expiry (last 7 days),
  lab report ready. Each can be switched off per hospital. Patients can opt out of reminders. Messages use the patient's language
  (English or Hindi).
- Providers: `MESSAGING_PROVIDER=console` prints messages (development only). `MESSAGING_PROVIDER=webhook` posts each message as JSON
  to `MESSAGING_WEBHOOK_URL` with `MESSAGING_WEBHOOK_TOKEN`; put a small adapter for your SMS/WhatsApp vendor behind it (DLT template
  ids and vendor credentials live there). The API refuses to start in production with the console provider.
- Set `DATABASE_URL` in `apps/worker/.env` (app role). Apps never hold the owner-role (migrator) credentials.

## Plans, signup and the operator console

- **Plans** (`packages/billing-core`): Pay per patient (₹200 for each new patient, once, up to 3 staff, health cards and the core flow),
  Starter (₹10,000 a month, 10 staff, pharmacy, lab, messaging with 500 free messages), Unlimited (₹20,000 a month, unlimited staff,
  2,000 messages). All before 18% GST. Messages above the quota are billed at ₹0.25.
- **Self-signup** at `/signup` (phone OTP): a 30-day trial with every feature, a clinic owner is also its doctor, default card plans,
  fee list and lab tests are created. When the trial ends the hospital moves to billing on the plan it chose.
- **Feature gates and seats** are enforced by the API (HTTP 402 with `code: UPGRADE`), and the sidebar shows locked modules.
- **Monthly invoices** are generated by the worker (hourly check, idempotent), due in 10 days. A hospital 7 days past due becomes
  read-only (reads work, writes return 402) and is reactivated the moment the operator records the payment.
- **Operator console** (`apps/web-platform`, port 5174): overview (MRR, patients, messages, outstanding), hospitals (change plan,
  extend trial, suspend, close), invoices (generate, record payment, void, run dunning). Operators sign in at `/auth/platform/login`;
  the demo operator is phone 9000000000. Operator accounts can only be created with the owner database role (never through the app).

## Security notes

- Web sessions: a 15-minute access token held in memory, plus a 30-day rotating refresh token in an httpOnly SameSite=Strict cookie.
  Using an old refresh token revokes the whole session family. Cookie requests need the `x-requested-with` header (CSRF).
  Mobile apps keep both tokens in the OS secure store. Hospital and operator sessions use different cookies.
- Passwords are scrypt hashed. Staff accounts are created by an owner or admin with a temporary password shown once; the person must
  change it at first sign-in. Owners can hold several roles (for example owner and doctor).
- The apps connect as `hms_app` (no DDL, no BYPASSRLS); only the migration job and seeds hold owner credentials.

## Money

- **Refunds** (owner or admin, with a reason, capped at what was paid) are append-only and reduce the day's collections and expected cash.
- **GST**: prices are tax-inclusive. Medicines carry 0, 5, 12, 18 or 28%; receipts show the CGST/SGST split as a tax invoice once the
  hospital adds its GSTIN under Settings, Hospital profile. Add a UPI id there to print a payment QR on every bill.
- **Online payments** (optional): set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in `apps/api/.env`, and point a
  Razorpay webhook for `payment_link.paid` at `POST /webhooks/razorpay`. Staff can create a payment link or SMS it, and patients can pay from
  the app. Webhooks are signature-checked, idempotent, and an overpayment is flagged instead of booked. This is written from Razorpay's
  documented API; test it against their sandbox before going live.

## Operator console (`apps/web-platform`)

The platform operator manages every hospital from one place.

- **Onboard** a hospital, clinic or pharmacy: name, type, plan, trial or active, owner's name and mobile number, features and staff limit. The owner's temporary password is shown once.
- **Feature switches** per hospital (Hospitals → a hospital → Features): Plan default, On or Off, with a required reason. Off features disappear from the hospital's menu and are refused by the API (`403 DISABLED`). Plan-locked features answer `402 UPGRADE`.
- **Limits**: staff accounts and branches per hospital.
- **Users**: reset a password or sign someone out everywhere; **Activity** shows the hospital's own audit trail.
- **System logs**: live-tailing, filterable by level, source, status, hospital or request id, with a 24-hour chart and failing routes. Request bodies and headers are never stored. Retention is set in System.
- **Operator audit**: an append-only record of every change made from the console.
- **Announcements**: banners shown to all or chosen hospitals, with a time window.
- **System**: health snapshot, **maintenance mode** (reads and sign-in continue; writes return `503`), open sign-ups, trial length and log retention.

## Inpatient care (IPD)

Switched on per organization as the **Inpatient care** feature (included in Unlimited, or enabled by the operator).

- **Wards and beds** with a daily rate per ward. Statuses: free, occupied, being cleaned, out of service. Only an admission can occupy a bed.
- **Admit, transfer, discharge.** The database guarantees one bed per patient and one patient per bed, even when two staff click at once. Each bed a patient has used is kept as a stay with the rate at that time, so a transfer never rewrites history.
- **Nursing chart:** vitals (validated ranges), notes, doctor's rounds and orders. Entries are append-only.
- **Discharge:** a structured summary, a PDF the patient takes home, and a bill raised from the stays (24-hour blocks with a two-hour grace, minimum one day) plus any extra charges, with optional payment at the desk.
- Permissions: `ipd:read`, `ipd:write` (admit, notes, transfer, discharge), `ipd:manage` (set up wards).

## Executive overview

`/executive` (permission `executive:read`): billing and collections against the same days last month, visits, new patients, bed occupancy and average stay, doctor-wise and branch-wise billing, discounts, refunds, voids, cash that did not tally, and ageing of dues. A short list of plain-language flags at the top says what needs a decision.

## ABDM readiness

Patients can carry an **ABHA number** (14 digits, unique per hospital) and **ABHA address**. Scanning an ABHA number finds the patient. This is *capture only*: connecting to the ABDM gateway (HIP/HIU, consent manager, record linking) needs the organization's registration with NHA and is not built.

## Chairman's pack

Each of these is a switchable feature per organization (Unlimited plan, or enabled by the operator), with its own permissions.

- **Insurance and TPA** (`insurance`): payers with credit terms, patient policies, claims through pre-authorisation, submission, queries, approval and settlement. A settlement posts an `INSURANCE` payment to the bill; a part payment keeps the claim open; amounts the insurer disallowed stay on the patient's bill. Every step is on an append-only trail. The summary shows what each insurer owes, what is overdue against their credit period, rejection rate and days to pay.
- **Operation theatres** (`ot`): theatre schedule; a booking that clashes on theatre, surgeon or anaesthetist is refused, even with two people booking at once. Start, complete (outcome required), postpone and cancel (reason required). Utilisation, on-time starts and average duration.
- **Emergency** (`emergency`): five-level triage board, sickest first, wait targets per level with breaches flagged, unidentified patients, arrival mode, door-to-doctor time, left-without-being-seen rate, and a link to the inpatient admission.
- **Staff** (`workforce`): roster, attendance (rostered against signed in, late and absent), leave with approval, and **doctor revenue share**: a rate per doctor and source, applied to money actually received in the month less refunds; a finished month can be approved and then marked paid.
- **Patient feedback** (`feedback`, on every plan): a no-sign-in link sent after discharge or on request, one answer per link, NPS overall, by week and by doctor, and the unhappiest comments first.
- **Exports and scheduled reports**: CSV that opens in Excel for collections, a GST sales register (taxable value and GST split), doctor share, unpaid bills and claims. Cells that could be read as spreadsheet formulas are neutralised. Reports can be scheduled daily, weekly or monthly and are waiting in the Exports page. Every download is audited.
- **Two-step sign-in**: authenticator-app codes (TOTP) and recovery codes for any staff member. After the password the server issues a five-minute ticket that is useless as an access token; a code works once; five wrong codes lock the second step for ten minutes. The organization admin can **require** it for everyone (people who have not set it up are held at a setup screen), and can reset someone who lost their phone. The platform operator can also reset it.
- **Executive overview** now includes insurer receivables, theatre use, emergency waits, satisfaction and staff on duty, with flags for each.

Not built: single sign-on, e-mailed delivery of scheduled reports (they are produced in the app), and the ABDM gateway.
