import { randomUUID } from "node:crypto";

export interface FhirBundleInput {
  hospital: {
    id: string;
    name: string;
    hfrId?: string | null;
    address?: { line1: string; city: string; state: string; pincode: string };
  };
  patient: {
    id: string;
    fullName: string;
    patientNo: string;
    gender?: string | null;
    dateOfBirth?: Date | string | null;
    phone?: string | null;
    abhaNumber?: string | null;
    abhaAddress?: string | null;
  };
  doctor?: {
    id?: string;
    name: string;
    registrationNo?: string | null;
    hprId?: string | null;
    specialty?: string | null;
  } | null;
  encounter: {
    id: string;
    type: "OPD" | "IPD" | "TELE";
    period: { start: Date; end?: Date | null };
  };
  diagnosis?: string | null;
  complaints?: string | null;
  advice?: string | null;
  vitals?: Record<string, number | string> | null;
  items?: {
    name: string;
    dose?: string | null;
    frequency?: string | null;
    durationDays?: number | null;
    instructions?: string | null;
    quantity?: number;
  }[];
  labOrders?: {
    orderNo: string;
    items: { testName: string; resultValue?: string | null; unit?: string | null }[];
  }[];
}

/**
 * Generates an HL7 FHIR Release 4 Document Bundle conforming to the
 * National Resource Centre for EHR Standards (NRCeS) India specifications for ABDM.
 */
export function buildFhirDocumentBundle(data: FhirBundleInput): Record<string, unknown> {
  const bundleId = randomUUID();
  const compositionId = randomUUID();
  const patientRefId = `Patient-${data.patient.id}`;
  const practitionerRefId = `Practitioner-${data.doctor?.id ?? "default"}`;
  const orgRefId = `Organization-${data.hospital.id}`;
  const encounterRefId = `Encounter-${data.encounter.id}`;
  const nowIso = new Date().toISOString();

  const entries: Record<string, unknown>[] = [];

  // 1. Composition Resource (Document Header)
  const composition = {
    fullUrl: `urn:uuid:${compositionId}`,
    resource: {
      resourceType: "Composition",
      id: compositionId,
      meta: {
        profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord"],
      },
      status: "final",
      type: {
        coding: [
          {
            system: "https://projecteka.in/snomed",
            code: "371530004",
            display: "Clinical consultation report",
          },
        ],
        text: data.encounter.type === "IPD" ? "Discharge Summary Record" : "Outpatient Consultation Record",
      },
      subject: { reference: `urn:uuid:${patientRefId}`, display: data.patient.fullName },
      encounter: { reference: `urn:uuid:${encounterRefId}` },
      date: nowIso,
      author: [{ reference: `urn:uuid:${practitionerRefId}`, display: data.doctor?.name ?? "Attending Physician" }],
      title: data.encounter.type === "IPD" ? "Inpatient Discharge Summary" : "Outpatient Clinical Consultation",
      custodian: { reference: `urn:uuid:${orgRefId}`, display: data.hospital.name },
      section: [
        ...(data.complaints
          ? [
              {
                title: "Chief Complaints",
                code: { coding: [{ system: "http://snomed.info/sct", code: "422843007", display: "Chief complaint section" }] },
                text: { status: "generated", div: `<div>${data.complaints}</div>` },
              },
            ]
          : []),
        ...(data.diagnosis
          ? [
              {
                title: "Diagnosis",
                code: { coding: [{ system: "http://snomed.info/sct", code: "29308-4", display: "Diagnosis" }] },
                text: { status: "generated", div: `<div>${data.diagnosis}</div>` },
              },
            ]
          : []),
        ...(data.items && data.items.length > 0
          ? [
              {
                title: "Medications Prescribed",
                code: { coding: [{ system: "http://snomed.info/sct", code: "10160-0", display: "History of Medication use" }] },
                text: {
                  status: "generated",
                  div: `<div>${data.items.map((i) => `${i.name} - ${i.dose ?? ""} ${i.frequency ?? ""} (${i.instructions ?? ""})`).join("<br/>")}</div>`,
                },
              },
            ]
          : []),
        ...(data.advice
          ? [
              {
                title: "Advice & Instructions",
                code: { coding: [{ system: "http://snomed.info/sct", code: "69730-0", display: "Instructions" }] },
                text: { status: "generated", div: `<div>${data.advice}</div>` },
              },
            ]
          : []),
      ],
    },
  };
  entries.push(composition);

  // 2. Patient Resource
  const patientResource = {
    fullUrl: `urn:uuid:${patientRefId}`,
    resource: {
      resourceType: "Patient",
      id: patientRefId,
      meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient"] },
      identifier: [
        {
          type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR", display: "Medical record number" }] },
          system: `https://swasthya.io/patients`,
          value: data.patient.patientNo,
        },
        ...(data.patient.abhaNumber
          ? [
              {
                type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "ABHA", display: "ABHA Number" }] },
                system: "https://healthid.ndhm.gov.in",
                value: data.patient.abhaNumber,
              },
            ]
          : []),
        ...(data.patient.abhaAddress
          ? [
              {
                type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "ABHA-ADDR", display: "ABHA Address" }] },
                system: "https://abdm.gov.in",
                value: data.patient.abhaAddress,
              },
            ]
          : []),
      ],
      name: [{ text: data.patient.fullName }],
      telecom: data.patient.phone ? [{ system: "phone", value: data.patient.phone, use: "mobile" }] : undefined,
      gender: data.patient.gender ? data.patient.gender.toLowerCase() : "unknown",
      birthDate: data.patient.dateOfBirth
        ? typeof data.patient.dateOfBirth === "string"
          ? data.patient.dateOfBirth.slice(0, 10)
          : data.patient.dateOfBirth.toISOString().slice(0, 10)
        : undefined,
      managingOrganization: { reference: `urn:uuid:${orgRefId}` },
    },
  };
  entries.push(patientResource);

  // 3. Practitioner Resource
  const practitionerResource = {
    fullUrl: `urn:uuid:${practitionerRefId}`,
    resource: {
      resourceType: "Practitioner",
      id: practitionerRefId,
      meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Practitioner"] },
      identifier: [
        ...(data.doctor?.registrationNo
          ? [
              {
                type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MD", display: "Medical License number" }] },
                system: "https://nmc.org.in",
                value: data.doctor.registrationNo,
              },
            ]
          : []),
        ...(data.doctor?.hprId
          ? [
              {
                type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "HPR", display: "Healthcare Professional Registry" }] },
                system: "https://hpr.abdm.gov.in",
                value: data.doctor.hprId,
              },
            ]
          : []),
      ],
      name: [{ text: data.doctor?.name ?? "Doctor" }],
    },
  };
  entries.push(practitionerResource);

  // 4. Organization Resource
  const orgResource = {
    fullUrl: `urn:uuid:${orgRefId}`,
    resource: {
      resourceType: "Organization",
      id: orgRefId,
      meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Organization"] },
      identifier: [
        ...(data.hospital.hfrId
          ? [
              {
                type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "HFR", display: "Health Facility Registry ID" }] },
                system: "https://facility.ndhm.gov.in",
                value: data.hospital.hfrId,
              },
            ]
          : []),
      ],
      name: data.hospital.name,
      address: data.hospital.address
        ? [
            {
              line: [data.hospital.address.line1],
              city: data.hospital.address.city,
              state: data.hospital.address.state,
              postalCode: data.hospital.address.pincode,
              country: "IND",
            },
          ]
        : undefined,
    },
  };
  entries.push(orgResource);

  // 5. Encounter Resource
  const encounterResource = {
    fullUrl: `urn:uuid:${encounterRefId}`,
    resource: {
      resourceType: "Encounter",
      id: encounterRefId,
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: data.encounter.type === "IPD" ? "IMP" : "AMB",
        display: data.encounter.type === "IPD" ? "inpatient encounter" : "ambulatory",
      },
      subject: { reference: `urn:uuid:${patientRefId}` },
      period: {
        start: data.encounter.period.start.toISOString(),
        end: (data.encounter.period.end ?? data.encounter.period.start).toISOString(),
      },
    },
  };
  entries.push(encounterResource);

  // 6. Condition (ICD-10 Diagnoses)
  if (data.diagnosis) {
    const conditionId = randomUUID();
    const conditionResource = {
      fullUrl: `urn:uuid:${conditionId}`,
      resource: {
        resourceType: "Condition",
        id: conditionId,
        clinicalStatus: {
          coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }],
        },
        code: {
          text: data.diagnosis,
        },
        subject: { reference: `urn:uuid:${patientRefId}` },
        encounter: { reference: `urn:uuid:${encounterRefId}` },
      },
    };
    entries.push(conditionResource);
  }

  // 7. MedicationRequests
  if (data.items) {
    for (const item of data.items) {
      const medId = randomUUID();
      const medResource = {
        fullUrl: `urn:uuid:${medId}`,
        resource: {
          resourceType: "MedicationRequest",
          id: medId,
          status: "active",
          intent: "order",
          medicationCodeableConcept: { text: item.name },
          subject: { reference: `urn:uuid:${patientRefId}` },
          encounter: { reference: `urn:uuid:${encounterRefId}` },
          dosageInstruction: [
            {
              text: `${item.dose ?? ""} ${item.frequency ?? ""} ${item.instructions ?? ""}`.trim(),
              timing: item.frequency ? { code: { text: item.frequency } } : undefined,
            },
          ],
        },
      };
      entries.push(medResource);
    }
  }

  // 8. Vital Signs Observations (LOINC coded)
  if (data.vitals) {
    const loincMap: Record<string, { code: string; display: string; unit: string }> = {
      systolic: { code: "8480-6", display: "Systolic blood pressure", unit: "mmHg" },
      diastolic: { code: "8462-4", display: "Diastolic blood pressure", unit: "mmHg" },
      pulse: { code: "8867-4", display: "Heart rate", unit: "/min" },
      spo2: { code: "59408-5", display: "Oxygen saturation in Arterial blood", unit: "%" },
      temperatureC: { code: "8310-5", display: "Body temperature", unit: "Cel" },
    };

    for (const [key, val] of Object.entries(data.vitals)) {
      const info = loincMap[key];
      if (info && val !== undefined && val !== null && val !== "") {
        const obsId = randomUUID();
        const obs = {
          fullUrl: `urn:uuid:${obsId}`,
          resource: {
            resourceType: "Observation",
            id: obsId,
            status: "final",
            category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
            code: { coding: [{ system: "http://loinc.org", code: info.code, display: info.display }] },
            subject: { reference: `urn:uuid:${patientRefId}` },
            effectiveDateTime: nowIso,
            valueQuantity: {
              value: Number(val),
              unit: info.unit,
              system: "http://unitsofmeasure.org",
            },
          },
        };
        entries.push(obs);
      }
    }
  }

  // Full Bundle
  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: {
      versionId: "1",
      lastUpdated: nowIso,
      profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle"],
    },
    identifier: {
      system: "https://swasthya.io/fhir/bundles",
      value: bundleId,
    },
    type: "document",
    timestamp: nowIso,
    entry: entries,
  };
}
