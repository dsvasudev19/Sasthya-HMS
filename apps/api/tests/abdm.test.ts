import assert from "node:assert/strict";
import test from "node:test";
import { makeApp, makeTenant, cleanupTenant, staffToken, auth, addStaff } from "./helpers";

test("ABDM / Indian Compliance end-to-end suite", async (t) => {
  const app = await makeApp();
  const f = await makeTenant("abdm-test");
  const token = await staffToken(app, f.receptionist.phone);
  const docToken = await staffToken(app, f.doctor.phone);
  const owner = await addStaff(f, "OWNER", "Admin Owner");
  const ownerToken = await staffToken(app, owner.phone);

  t.after(async () => {
    await cleanupTenant(f);
    await app.close();
  });

  // Create a patient
  const patientRes = await app.inject({
    method: "POST",
    url: "/patients",
    headers: auth(token),
    payload: {
      fullName: "Rohan Sharma",
      gender: "MALE",
      dateOfBirth: "1992-06-15",
      phone: "9876543210",
    },
  });
  assert.equal(patientRes.statusCode, 201);
  const patient = patientRes.json();
  assert.ok(patient.id);

  let verifiedAbha: { abhaNumber: string; abhaAddress: string };

  await t.test("M1: ABHA OTP generation & verification", async () => {
    // 1. Generate OTP
    const genRes = await app.inject({
      method: "POST",
      url: "/abdm/abha/generate-otp",
      headers: auth(token),
      payload: {
        identifier: "9876543210",
        authMode: "MOBILE_OTP",
      },
    });
    assert.equal(genRes.statusCode, 200);
    const genBody = genRes.json();
    assert.ok(genBody.txnId);
    assert.equal(genBody.sandboxOtp, "123456");

    // 2. Verify with wrong OTP -> 400
    const failRes = await app.inject({
      method: "POST",
      url: "/abdm/abha/verify-otp",
      headers: auth(token),
      payload: {
        txnId: genBody.txnId,
        otp: "000000",
      },
    });
    assert.equal(failRes.statusCode, 400);

    // 3. Verify with valid sandbox OTP
    const verifyRes = await app.inject({
      method: "POST",
      url: "/abdm/abha/verify-otp",
      headers: auth(token),
      payload: {
        txnId: genBody.txnId,
        otp: "123456",
        name: "Rohan Sharma",
        gender: "MALE",
        yearOfBirth: "1992",
      },
    });
    assert.equal(verifyRes.statusCode, 200);
    const verified = verifyRes.json();
    assert.equal(verified.verified, true);
    assert.match(verified.abhaNumber, /^\d{14}$/);
    assert.match(verified.abhaAddress, /@abdm$/);
    verifiedAbha = verified;

    // 4. Link ABHA to patient
    const linkRes = await app.inject({
      method: "POST",
      url: `/patients/${patient.id}/abha/link`,
      headers: auth(token),
      payload: {
        abhaNumber: verified.abhaNumber,
        abhaAddress: verified.abhaAddress,
      },
    });
    assert.equal(linkRes.statusCode, 200);
    const linked = linkRes.json();
    assert.equal(linked.abhaNumber, verified.abhaNumber);
    assert.equal(linked.abhaAddress, verified.abhaAddress);
    assert.ok(linked.careContexts.length >= 1);
    assert.equal(linked.careContexts[0].careContextRef, `PAT-${patient.patientNo}`);
  });

  await t.test("M2: Care Context Discovery callback", async () => {
    // Call NHA Gateway discovery endpoint
    const discRes = await app.inject({
      method: "POST",
      url: "/abdm/v1.0/care-contexts/discover",
      headers: { "x-tenant-id": f.tenantId },
      payload: {
        requestId: "REQ-DISC-1001",
        timestamp: new Date().toISOString(),
        patient: {
          id: verifiedAbha.abhaAddress,
          verifiedIdentifiers: [{ type: "MOBILE", value: patient.phone }],
        },
      },
    });
    assert.equal(discRes.statusCode, 200);
    const discBody = discRes.json();
    assert.ok(discBody.patient);
    assert.equal(discBody.patient.name, "Rohan Sharma");
    assert.ok(discBody.patient.careContexts.length >= 1);
    assert.equal(discBody.patient.careContexts[0].referenceNumber, `PAT-${patient.patientNo}`);
  });

  await t.test("M3: NRCeS FHIR R4 OPConsultRecord Bundle Export", async () => {
    // 1. Create appointment & check in
    const apptRes = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: auth(token),
      payload: {
        patientId: patient.id,
        scheduledAt: new Date().toISOString(),
      },
    });
    assert.equal(apptRes.statusCode, 201);
    const appt = apptRes.json();

    // Check in via PATCH
    const checkinRes = await app.inject({
      method: "PATCH",
      url: `/appointments/${appt.id}`,
      headers: auth(token),
      payload: { status: "CHECKED_IN" },
    });
    assert.equal(checkinRes.statusCode, 200);

    // Doctor consults: saves vitals, diagnosis, rx, advice
    const saveRes = await app.inject({
      method: "PUT",
      url: `/appointments/${appt.id}/consultation`,
      headers: auth(docToken),
      payload: {
        complaints: "Persistent dry cough for 3 days with mild fever",
        diagnosis: "Acute Bronchitis (J20.9)",
        advice: "Steam inhalation twice daily, drink warm water",
        vitals: { bpSystolic: 120, bpDiastolic: 80, pulse: 76, tempC: 37.8, spo2: 99 },
        items: [
          { name: "Paracetamol 650mg", dose: "1 tab", frequency: "1-0-1", durationDays: 3, quantity: 6 },
          { name: "Levocetirizine 5mg", dose: "1 tab", frequency: "0-0-1", durationDays: 5, quantity: 5 },
        ],
      },
    });
    assert.equal(saveRes.statusCode, 200);
    const consult = saveRes.json();

    // 2. Fetch FHIR R4 Bundle
    const fhirRes = await app.inject({
      method: "GET",
      url: `/consultations/${consult.id}/fhir`,
      headers: auth(docToken),
    });
    assert.equal(fhirRes.statusCode, 200);
    assert.match(fhirRes.headers["content-type"] as string, /^application\/fhir\+json/);

    const bundle = fhirRes.json();
    assert.equal(bundle.resourceType, "Bundle");
    assert.equal(bundle.type, "document");
    assert.ok(bundle.meta?.profile?.some((p: string) => p.includes("DocumentBundle")));

    // Verify bundle entries
    const resources = bundle.entry.map((e: { resource: { resourceType: string } }) => e.resource.resourceType);
    assert.ok(resources.includes("Composition"), "Bundle must contain Composition");
    assert.ok(resources.includes("Patient"), "Bundle must contain Patient");
    assert.ok(resources.includes("Encounter"), "Bundle must contain Encounter");
    assert.ok(resources.includes("Condition"), "Bundle must contain Condition");
    assert.ok(resources.includes("MedicationRequest"), "Bundle must contain MedicationRequest");
    assert.ok(resources.includes("Observation"), "Bundle must contain Observation");

    // Check Patient ABHA identifier
    const patientResource = bundle.entry.find((e: { resource: { resourceType: string } }) => e.resource.resourceType === "Patient").resource;
    assert.ok(patientResource.identifier.some((i: { system: string }) => i.system.includes("healthid")));

    // Check Composition NRCeS Profile
    const composition = bundle.entry[0].resource;
    assert.equal(composition.resourceType, "Composition");
    assert.equal(composition.status, "final");
  });

  await t.test("ABDM Facility Configuration & Consent Audit", async () => {
    // 1. GET initial facility config
    const getCfgRes = await app.inject({
      method: "GET",
      url: "/abdm/facility-config",
      headers: auth(ownerToken),
    });
    assert.equal(getCfgRes.statusCode, 200);

    // 2. PUT facility config
    const putCfgRes = await app.inject({
      method: "PUT",
      url: "/abdm/facility-config",
      headers: auth(ownerToken),
      payload: {
        hfrFacilityId: "IN2910009999",
        facilityName: "Sanskar Hospital ABDM Center",
        hipId: "SANSKAR-HIP-01",
        clientId: "SBX_TEST_CLIENT_01",
        sandbox: true,
      },
    });
    assert.equal(putCfgRes.statusCode, 200);
    const updatedCfg = putCfgRes.json();
    assert.equal(updatedCfg.hfrFacilityId, "IN2910009999");
    assert.equal(updatedCfg.hipId, "SANSKAR-HIP-01");

    // 3. GET consents list
    const consentsRes = await app.inject({
      method: "GET",
      url: "/abdm/consents",
      headers: auth(token),
    });
    assert.equal(consentsRes.statusCode, 200);
    assert.ok(Array.isArray(consentsRes.json()));
  });

  await t.test("Patient ABHA unlinking", async () => {
    const unlinkRes = await app.inject({
      method: "POST",
      url: `/patients/${patient.id}/abha/unlink`,
      headers: auth(token),
    });
    assert.equal(unlinkRes.statusCode, 200);
    const unlinked = unlinkRes.json();
    assert.equal(unlinked.unlinked, true);

    const getPat = await app.inject({
      method: "GET",
      url: `/patients/${patient.id}`,
      headers: auth(token),
    });
    assert.equal(getPat.statusCode, 200);
    assert.equal(getPat.json().abhaNumber, null);
  });
});
