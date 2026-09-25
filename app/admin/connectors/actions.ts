"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@platform/auth";
import { writeAudit } from "@platform/audit";
import { getConnector } from "@platform/connectors";
import { prisma } from "@platform/db";
import { CONNECTORS_PERMISSION, isUniqueViolation, referenceFor, syntheticRisk } from "./import";

export async function pullIntoKycAction(formData: FormData) {
  const connectorId = String(formData.get("connectorId") ?? "");
  const user = await requirePermission(CONNECTORS_PERMISSION);

  const connector = getConnector(connectorId);
  if (!connector || connector.status !== "live") {
    redirect(`/admin/connectors?error=${encodeURIComponent("Not wired in this prototype")}`);
  }

  const records = await connector.listRecords();

  let imported = 0;
  let updated = 0;
  for (const record of records) {
    const reference = referenceFor(connector.id, record.id);
    const applicant = {
      applicantName: record.name,
      applicantCountry: record.country,
      riskScore: syntheticRisk(record.id),
    };
    /** One transaction per record: a concurrent pull losing the unique race retries as an update, not a failed batch. */
    try {
      const existing = await prisma.kycCase.findUnique({ where: { reference } });
      if (existing) {
        const unchanged =
          existing.applicantName === applicant.applicantName &&
          existing.applicantCountry === applicant.applicantCountry &&
          existing.riskScore === applicant.riskScore;
        if (unchanged) continue;
        await prisma.$transaction(async (tx) => {
          const next = await tx.kycCase.update({ where: { reference }, data: applicant });
          await writeAudit(tx, user, {
            app: "kyc",
            entityType: "KycCase",
            entityId: next.id,
            action: `import:${connector.id}`,
            before: {
              applicantName: existing.applicantName,
              applicantCountry: existing.applicantCountry,
              riskScore: existing.riskScore,
            },
            after: { reference, ...applicant },
          });
        });
        updated += 1;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const created = await tx.kycCase.create({ data: { reference, ...applicant, status: "NEW" } });
        await writeAudit(tx, user, {
          app: "kyc",
          entityType: "KycCase",
          entityId: created.id,
          action: `import:${connector.id}`,
          after: { reference, applicantName: created.applicantName, riskScore: created.riskScore },
        });
      });
      imported += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  revalidatePath("/admin/connectors");
  revalidatePath("/kyc");
  revalidatePath("/admin/audit");
  redirect(`/admin/connectors?imported=${imported}&updated=${updated}&seen=${records.length}`);
}
