import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSession } from "@platform/auth";
import { prisma } from "@platform/db";
import { cookieJar } from "./next-mocks";

/** Vitest does not read `.env`; CI supplies these as real environment variables. */
function loadDotEnv() {
  if (process.env.DATABASE_URL) return;
  try {
    const raw = readFileSync(resolve(__dirname, "..", ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = /^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // CI: environment already configured.
  }
}
loadDotEnv();

const createdUserIds: string[] = [];
const createdRoleIds: string[] = [];
const createdFlagIds: string[] = [];
const createdCaseIds: string[] = [];

function suffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** A user whose role grants exactly `permissions` — nothing is inherited from the seed. */
export async function makeUser(permissions: string[], label = "user") {
  const s = suffix();
  const perms = await Promise.all(
    permissions.map((key) =>
      prisma.permission.upsert({ where: { key }, update: {}, create: { key, app: key.split(".")[0] } }),
    ),
  );
  const role = await prisma.role.create({
    data: {
      key: `test_${label}_${s}`,
      description: "test fixture role",
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
    },
  });
  const user = await prisma.user.create({
    data: {
      email: `${label}.${s}@test.local`,
      name: `Test ${label}`,
      roles: { create: { roleId: role.id } },
    },
  });
  createdUserIds.push(user.id);
  createdRoleIds.push(role.id);
  return user;
}

type EnvSeed = { enabled?: boolean; rolloutPercentage?: number; targetUserIds?: string[] };

export async function makeFlag(opts: {
  archived?: boolean;
  dev?: EnvSeed;
  staging?: EnvSeed;
  prod?: EnvSeed;
} = {}) {
  const flag = await prisma.featureFlag.create({
    data: {
      key: `test.flag_${suffix()}`,
      description: "fixture flag",
      ownerEmail: "owner@test.local",
      archived: opts.archived ?? false,
      envStates: {
        create: [
          { env: "DEV", ...(opts.dev ?? {}) },
          { env: "STAGING", ...(opts.staging ?? {}) },
          { env: "PROD", ...(opts.prod ?? {}) },
        ],
      },
    },
    include: { envStates: true },
  });
  createdFlagIds.push(flag.id);
  return flag;
}

/** Register a flag an action created, so cleanup removes it too. */
export function trackFlag(flagId: string) {
  createdFlagIds.push(flagId);
}

export async function envState(flagId: string, env: "DEV" | "STAGING" | "PROD") {
  return prisma.flagEnvState.findUniqueOrThrow({ where: { flagId_env: { flagId, env } } });
}

export async function makeCase(opts: {
  riskScore?: number;
  status?: "NEW" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "ESCALATED";
  assigneeId?: string | null;
  lastEscalatedById?: string | null;
} = {}) {
  const kycCase = await prisma.kycCase.create({
    data: {
      reference: `TEST-${suffix()}`,
      applicantName: "Fixture Applicant",
      applicantCountry: "NL",
      riskScore: opts.riskScore ?? 10,
      status: opts.status ?? "NEW",
      assigneeId: opts.assigneeId ?? null,
      lastEscalatedById: opts.lastEscalatedById ?? null,
    },
  });
  createdCaseIds.push(kycCase.id);
  return kycCase;
}

export async function signIn(userId: string) {
  cookieJar.clear();
  await createSession(userId);
}

export function signOut() {
  cookieJar.clear();
}

export async function auditFor(entityId: string) {
  return prisma.auditEvent.findMany({ where: { entityId }, orderBy: { at: "asc" } });
}

/** Fixtures are unique-suffixed, so cleanup never touches seeded demo data. */
export async function cleanupFixtures() {
  const entityIds = [...createdFlagIds, ...createdCaseIds];
  if (entityIds.length > 0 || createdUserIds.length > 0) {
    await prisma.auditEvent.deleteMany({
      where: { OR: [{ entityId: { in: entityIds } }, { actorId: { in: createdUserIds } }] },
    });
  }
  await prisma.featureFlag.deleteMany({ where: { id: { in: createdFlagIds } } });
  await prisma.kycCase.deleteMany({ where: { id: { in: createdCaseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
  createdFlagIds.length = 0;
  createdCaseIds.length = 0;
  createdUserIds.length = 0;
  createdRoleIds.length = 0;
  cookieJar.clear();
}
