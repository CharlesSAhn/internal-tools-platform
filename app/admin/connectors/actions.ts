"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@platform/auth";
import { writeAudit } from "@platform/audit";
import { getConnector, type ConnectorRecord } from "@platform/connectors";
import { prisma, type Tx } from "@platform/db";
import {
  applyMapping,
  CONNECTORS_PERMISSION,
  isUniqueViolation,
  legacyReferenceFor,
  loadMapping,
  referenceFor,
  syntheticRisk,
  type Applicant,
} from "./import";

type Outcome = "imported" | "updated" | "skipped";

export async function pullIntoKycAction(formData: FormData) {
  const connectorId = String(formData.get("connectorId") ?? "");
  const user = await requirePermission(CONNECTORS_PERMISSION);

  const connector = getConnector(connectorId);
  if (!connector || connector.status !== "live") {
    redirect(`/admin/connectors?error=${encodeURIComponent("Not wired in this prototype")}`);
  }

  const [records, mapping] = await Promise.all([connector.listRecords(), loadMapping(connector.id)]);
  const importAction = `import:${connector.id}`;

  /**
   * One transaction per record, reading the case inside it so the audit `before` is the row that
   * was actually replaced rather than a snapshot taken before the transaction began.
   */
  async function applyRecord(record: ConnectorRecord, applicant: Applicant): Promise<Outcome> {
    const key = { source: connector!.id, sourceId: record.id };
    return prisma.$transaction(async (tx) => {
      const existing =
        (await tx.kycCase.findUnique({ where: { source_sourceId: key } })) ?? (await adoptLegacy(tx, record));
      if (!existing) {
        const row = await tx.kycCase.create({ data: { ...key, ...applicant, reference: `pending-${record.id}`, status: "NEW" } });
        const created = await tx.kycCase.update({
          where: { id: row.id },
          data: { reference: referenceFor(row.caseNumber) },
        });
        await writeAudit(tx, user, {
          app: "kyc",
          entityType: "KycCase",
          entityId: created.id,
          action: importAction,
          after: { ...key, reference: created.reference, applicantName: created.applicantName, riskScore: created.riskScore },
        });
        return "imported";
      }

      /** Source refreshes only apply before review; a decided case keeps the data it was decided on. */
      if (existing.status !== "NEW") return "skipped";

      const unchanged =
        existing.applicantName === applicant.applicantName &&
        existing.applicantCountry === applicant.applicantCountry &&
        existing.riskScore === applicant.riskScore;
      if (unchanged) return "skipped";

      const next = await tx.kycCase.update({ where: { id: existing.id }, data: applicant });
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
        after: { ...key, reference: existing.reference, ...applicant },
      });
      return "updated";
    });
  }

  /**
   * Cases imported before `source`/`sourceId` existed carry the connector id in their reference and a
   * null sourceId. Claim them under the new key so a re-pull refreshes them instead of duplicating.
   */
  async function adoptLegacy(tx: Tx, record: ConnectorRecord) {
    const legacy = await tx.kycCase.findUnique({ where: { reference: legacyReferenceFor(connector!.id, record.id) } });
    if (!legacy || legacy.sourceId !== null) return null;
    return tx.kycCase.update({
      where: { id: legacy.id },
      data: { source: connector!.id, sourceId: record.id },
    });
  }

  let imported = 0;
  let updated = 0;
  for (const record of records) {
    const applicant = { ...applyMapping(mapping, record), riskScore: syntheticRisk(record.id) };

    let outcome: Outcome;
    try {
      outcome = await applyRecord(record, applicant);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      /** A concurrent pull inserted this source record first: retry, which now takes the refresh path. */
      outcome = await applyRecord(record, applicant);
    }

    if (outcome === "imported") imported += 1;
    else if (outcome === "updated") updated += 1;
  }

  /** One summary row per pull, so the catalog can show recent activity even when nothing changed. */
  await writeAudit(prisma, user, {
    app: "admin",
    entityType: "Connector",
    entityId: connector.id,
    action: "pull",
    after: { seen: records.length, imported, updated },
  });

  revalidatePath("/admin/connectors");
  revalidatePath("/kyc");
  revalidatePath("/admin/audit");
  redirect(`/admin/connectors?imported=${imported}&updated=${updated}&seen=${records.length}`);
}
