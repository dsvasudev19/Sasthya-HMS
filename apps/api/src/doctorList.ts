import { can } from "@hms/auth";
import { withTenant, type PrismaClient } from "@hms/db";

export interface DoctorRow {
  id: string; name: string | null; hasProfile: boolean; active: boolean; specialty: string | null; qualification: string | null; registrationNo: string | null;
  feeInPersonPaise: number | null; feeTelePaise: number | null; slotMinutes: number; branchIds: string[];
}

/** Staff whose role lets them write clinical notes, merged with their doctor profile (fees, schedule) when they have one. */
export async function listDoctors(db: PrismaClient, tenantId: string): Promise<DoctorRow[]> {
  const roles = await db.tenantRole.findMany({ where: { tenantId } });
  const clinical = new Set(roles.filter((r) => can(r.permissions, "clinical:write")).map((r) => r.key));
  const members = await db.tenantMembership.findMany({ where: { tenantId, role: { in: [...clinical] } }, include: { identity: true } });
  const profiles = await withTenant(db, tenantId, (tx) => tx.doctorProfile.findMany({ include: { schedules: true } }));
  const byIdentity = new Map(profiles.map((p) => [p.identityId, p]));
  const seen = new Set<string>();
  const out: DoctorRow[] = [];
  for (const m of members) {
    if (seen.has(m.identityId)) continue;
    seen.add(m.identityId);
    const p = byIdentity.get(m.identityId);
    out.push({
      id: m.identityId, name: p?.displayName ?? m.identity.fullName, hasProfile: !!p, active: p?.active ?? true,
      specialty: p?.specialty ?? null, qualification: p?.qualification ?? null, registrationNo: p?.registrationNo ?? null,
      feeInPersonPaise: p?.feeInPersonPaise ?? null, feeTelePaise: p?.feeTelePaise ?? null, slotMinutes: p?.slotMinutes ?? 15,
      branchIds: [...new Set((p?.schedules ?? []).map((s) => s.branchId))],
    });
  }
  return out;
}
