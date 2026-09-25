/** Owned by the KYC app session. */
import { prisma } from "../platform/db";
import type { KycStatus } from "@prisma/client";

const APPLICANTS: [string, string][] = [
  ["Amara Okonkwo", "NG"],
  ["Lucas Meyer", "DE"],
  ["Sofia Rossi", "IT"],
  ["Hiroshi Tanaka", "JP"],
  ["Elena Petrova", "BG"],
  ["Mateo Alvarez", "ES"],
  ["Priya Nair", "IN"],
  ["Jonas Lindqvist", "SE"],
  ["Fatima Al-Rashid", "AE"],
  ["Daniel Kim", "KR"],
  ["Chloe Dubois", "FR"],
  ["Tomas Novak", "CZ"],
  ["Grace Mwangi", "KE"],
  ["Oliver Bennett", "GB"],
  ["Isabel Santos", "BR"],
  ["Nikolai Volkov", "RU"],
  ["Mei Ling Chan", "SG"],
  ["Ahmed Hassan", "EG"],
  ["Laura Jansen", "NL"],
  ["Carlos Mendoza", "MX"],
];

const DOC_TYPES = ["passport", "proof_of_address", "selfie"] as const;
const STATUSES: KycStatus[] = ["NEW", "IN_REVIEW", "APPROVED", "REJECTED", "ESCALATED"];
const CASE_COUNT = 60;

/** Deterministic pseudo-random so reseeding produces an identical dataset. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export async function seedKyc() {
  const [riley, sam] = await Promise.all([
    prisma.user.findUnique({ where: { email: "riley.reviewer@example.com" } }),
    prisma.user.findUnique({ where: { email: "sam.senior@example.com" } }),
  ]);

  // Wipe and recreate so `npm run db:seed` is idempotent.
  await prisma.auditEvent.deleteMany({ where: { app: "kyc" } });
  await prisma.kycDocument.deleteMany({});
  await prisma.kycCase.deleteMany({});

  const rand = rng(20240917);
  const base = Date.UTC(2025, 7, 1);

  for (let i = 0; i < CASE_COUNT; i++) {
    const [applicantName, applicantCountry] = APPLICANTS[i % APPLICANTS.length];
    const status = STATUSES[i % STATUSES.length];
    // Cycle low / medium / high risk bands so every filter has rows.
    const band = i % 3;
    const riskScore = band === 0 ? Math.floor(rand() * 40) : band === 1 ? 40 + Math.floor(rand() * 40) : 80 + Math.floor(rand() * 21);

    const needsAssignee = status === "IN_REVIEW" || status === "APPROVED" || status === "REJECTED";
    const assignee = needsAssignee ? (riskScore >= 80 ? sam : i % 2 === 0 ? riley : sam) : null;

    await prisma.kycCase.create({
      data: {
        reference: `KYC-${1000 + i}`,
        applicantName: `${applicantName}${i >= APPLICANTS.length ? ` ${Math.floor(i / APPLICANTS.length) + 1}` : ""}`,
        applicantCountry,
        riskScore,
        status,
        assigneeId: assignee?.id ?? null,
        lastEscalatedById: status === "ESCALATED" ? (i % 2 === 0 ? (riley?.id ?? null) : (sam?.id ?? null)) : null,
        submittedAt: new Date(base + i * 7 * 3600 * 1000),
        documents: {
          create: Array.from({ length: 1 + (i % 3) }, (_, d) => ({
            type: DOC_TYPES[d],
            filename: `KYC-${1000 + i}-${DOC_TYPES[d]}.pdf`,
            verified: (i + d) % 3 !== 0,
          })),
        },
      },
    });
  }

  console.log(`seeded ${CASE_COUNT} kyc cases`);
}
