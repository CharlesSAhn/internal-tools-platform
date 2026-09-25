"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@platform/auth";
import { writeAudit } from "@platform/audit";
import { getConnector } from "@platform/connectors";
import { prisma } from "@platform/db";
import { CONNECTORS_PERMISSION, isUniqueViolation, referenceFor, syntheticRisk } from "./import";

type Applicant = { applicantName: string; applicantCountry: string; riskScore: number };
type Outcome = "imported" | "updated" | "skipped";

export async function pullIntoKycAction(formData: FormData) {
  const connectorId = String(formData.get("connectorId") ?? "");
  const user = await requirePermission(CONNECTORS_PERMISSION);

  const connector = getConnector(connectorId);
  if (!connector || connector.status !== "live") {
    redirect(`/admin/connectors?error=${encodeURIComponent("Not wired in this prototype")}`);
  }

  const records = await connector.listRecords();
  const importAction = `import:${connector.id}`;

  /**
   * One transaction per record, reading the case inside it so the audit `before` is the row that
   * was actually replaced rather than a snapshot taken before the transaction began.
   */
  async function applyRecord(reference: string, applicant: Applicant): Promise<Outcome> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.kycCase.findUnique({ where: { reference } });
      if (!existing) {
        const created = await tx.kycCase.create({ data: { reference, ...applicant, status: "NEW" } });
        await writeAudit(tx, user, {
          app: "kyc",
          entityType: "KycCase",
          entityId: created.id,
          action: importAction,
          after: { reference, applicantName: created.applicantName, riskScore: created.riskScore },
        });
        return "imported";
      }

      /** A reviewed case keeps the data its decision was made on; only an untouched case is refreshed. */
      if (existing.status !== "NEW") return "skipped";
      const unchanged =
        existing.applicantName === applicant.applicantName &&
        existing.applicantCountry === applicant.applicantCountry &&
        existing.riskScore === applicant.riskScore;
      if (unchanged) return "skipped";

      const next = await tx.kycCase.update({ where: { reference }, data: applicant });
      await writeAudit(tx, user, {
        app: "kyc",
        entityType: "KycCase",
        entityId: next.id,
        action: importAction,
        before: {
          applicantName: existing.applicantName,
          applicantCountry: existing.applicantCountry,
          riskScore: existing.riskScore,
        },
        after: { reference, ...applicant },
      });
      return "updated";
    });
  }

  let imported = 0;
  let updated = 0;
  for (const record of records) {
    const reference = referenceFor(connector.id, record.id);
    const applicant = {
      applicantName: record.name,
      applicantCountry: record.country,
      riskScore: syntheticRisk(record.id),
    };

    let outcome: Outcome;
    try {
      outcome = await applyRecord(reference, applicant);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      /** A concurrent pull inserted this reference first: retry, which now takes the refresh path. */
      outcome = await applyRecord(reference, applicant);
    }

    if (outcome === "imported") imported += 1;
    else if (outcome === "updated") updated += 1;
  }

  revalidatePath("/admin/connectors");
  revalidatePath("/kyc");
  revalidatePath("/admin/audit");
  redirect(`/admin/connectors?imported=${imported}&updated=${updated}&seen=${records.length}`);
}
