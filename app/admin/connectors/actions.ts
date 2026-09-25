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
  for (const record of records) {
    const reference = referenceFor(connector.id, record.id);
    if (await prisma.kycCase.findUnique({ where: { reference }, select: { id: true } })) continue;
    /** One transaction per record: a concurrent pull losing the unique race skips that record, not the batch. */
    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.kycCase.create({
          data: {
            reference,
            applicantName: record.name,
            applicantCountry: record.country,
            riskScore: syntheticRisk(record.id),
            status: "NEW",
          },
        });
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
  redirect(`/admin/connectors?imported=${imported}&seen=${records.length}`);
}
