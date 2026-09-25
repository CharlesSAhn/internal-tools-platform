import { prisma } from "../platform/db";

/** Owned by the feature-flags app session. */

type EnvSeed = { enabled: boolean; rolloutPercentage: number; targetUserIds?: string[] };

type FlagSeed = {
  key: string;
  description: string;
  ownerEmail: string;
  archived?: boolean;
  dev: EnvSeed;
  staging: EnvSeed;
  prod: EnvSeed;
};

const off: EnvSeed = { enabled: false, rolloutPercentage: 0 };
const fullOn: EnvSeed = { enabled: true, rolloutPercentage: 100 };

const FLAGS: FlagSeed[] = [
  {
    key: "checkout.new_pricing",
    description: "New pricing engine on the checkout page",
    ownerEmail: "fran.flagadmin@example.com",
    dev: fullOn,
    staging: fullOn,
    prod: { enabled: true, rolloutPercentage: 25 },
  },
  {
    key: "checkout.apple_pay",
    description: "Apple Pay as a checkout payment method",
    ownerEmail: "eli.editor@example.com",
    dev: fullOn,
    staging: { enabled: true, rolloutPercentage: 50 },
    prod: off,
  },
  {
    key: "onboarding.guided_tour",
    description: "Guided product tour for newly activated accounts",
    ownerEmail: "eli.editor@example.com",
    dev: fullOn,
    staging: fullOn,
    prod: fullOn,
  },
  {
    key: "onboarding.sms_verification",
    description: "SMS step during account verification",
    ownerEmail: "fran.flagadmin@example.com",
    dev: fullOn,
    staging: { enabled: true, rolloutPercentage: 10, targetUserIds: ["u_qa_1", "u_qa_2"] },
    prod: off,
  },
  {
    key: "search.vector_ranking",
    description: "Embedding-based ranking for catalogue search",
    ownerEmail: "avery.admin@example.com",
    dev: fullOn,
    staging: { enabled: true, rolloutPercentage: 75 },
    prod: { enabled: true, rolloutPercentage: 5, targetUserIds: ["u_internal_search"] },
  },
  {
    key: "search.typeahead_v2",
    description: "Rewritten typeahead suggestion service",
    ownerEmail: "eli.editor@example.com",
    dev: fullOn,
    staging: fullOn,
    prod: { enabled: true, rolloutPercentage: 100 },
  },
  {
    key: "billing.invoice_pdf_v2",
    description: "New invoice PDF renderer",
    ownerEmail: "fran.flagadmin@example.com",
    dev: fullOn,
    staging: { enabled: true, rolloutPercentage: 100 },
    prod: { enabled: true, rolloutPercentage: 40 },
  },
  {
    key: "billing.dunning_emails",
    description: "Automated dunning email sequence for failed payments",
    ownerEmail: "avery.admin@example.com",
    dev: fullOn,
    staging: off,
    prod: off,
  },
  {
    key: "kyc.auto_approve_low_risk",
    description: "Auto-approve KYC cases with risk score under 20",
    ownerEmail: "fran.flagadmin@example.com",
    dev: { enabled: true, rolloutPercentage: 100, targetUserIds: ["u_reviewer_riley"] },
    staging: { enabled: true, rolloutPercentage: 30 },
    prod: off,
  },
  {
    key: "platform.dark_mode",
    description: "Dark theme across internal tools",
    ownerEmail: "eli.editor@example.com",
    dev: fullOn,
    staging: fullOn,
    prod: { enabled: true, rolloutPercentage: 60 },
  },
  {
    key: "platform.read_replica_reads",
    description: "Route heavy read queries to the Postgres read replica",
    ownerEmail: "avery.admin@example.com",
    dev: fullOn,
    staging: { enabled: true, rolloutPercentage: 100 },
    prod: { enabled: false, rolloutPercentage: 0 },
  },
  {
    key: "growth.referral_banner",
    description: "Referral banner on the dashboard (retired campaign)",
    ownerEmail: "eli.editor@example.com",
    archived: true,
    dev: off,
    staging: off,
    prod: off,
  },
];

function envRows(f: FlagSeed) {
  return [
    { env: "DEV" as const, ...f.dev, targetUserIds: f.dev.targetUserIds ?? [] },
    { env: "STAGING" as const, ...f.staging, targetUserIds: f.staging.targetUserIds ?? [] },
    { env: "PROD" as const, ...f.prod, targetUserIds: f.prod.targetUserIds ?? [] },
  ];
}

export async function seedFlags() {
  const reset = process.env.RESET_DEMO === "1";
  if (reset) {
    await prisma.flagEnvState.deleteMany({});
    await prisma.featureFlag.deleteMany({});
  }

  for (const f of FLAGS) {
    const existing = await prisma.featureFlag.findUnique({
      where: { key: f.key },
      include: { envStates: true },
    });

    if (!existing) {
      await prisma.featureFlag.create({
        data: {
          key: f.key,
          description: f.description,
          ownerEmail: f.ownerEmail,
          archived: f.archived ?? false,
          envStates: { create: envRows(f) },
        },
      });
      continue;
    }

    const missing = envRows(f).filter((row) => !existing.envStates.some((s) => s.env === row.env));
    if (missing.length > 0) {
      await prisma.flagEnvState.createMany({
        data: missing.map((row) => ({ flagId: existing.id, ...row })),
      });
    }
  }
  console.log(
    reset
      ? `reset demo data: ${FLAGS.length} feature flags with ${FLAGS.length * 3} environment states`
      : `seeded ${FLAGS.length} demo feature flags (existing flag configuration left untouched)`,
  );
}
