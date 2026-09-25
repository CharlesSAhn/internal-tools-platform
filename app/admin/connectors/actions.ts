"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@platform/auth";
import { writeAudit } from "@platform/audit";
import { getConnector } from "@platform/connectors";
import { prisma } from "@platform/db";
import { CONNECTORS_PERMISSION, referenceFor, syntheticRisk } from "./import";

export async function pullIntoKycAction(formData: FormData) {
  const connectorId = String(formData.get("connectorId") ?? "");
  const user = await requirePermission(CONNECTORS_PERMISSION);

  const connector = getConnector(connectorId);
  if (!connector || connector.status !== "live") {
    redirect(`/admin/connectors?error=${encodeURIComponent("Not wired in this prototype")}`);
  }

  const records = await connector.listRecords();

  let imported = 0;
  await prisma.$transaction(async (tx) => {
    for (const record of records) {
      const reference = referenceFor(connector.id, record.id);
      const existing = await tx.kycCase.findUnique({ where: { reference } });
      if (existing) continue;

      const created = await tx.kycCase.create({
        data: {
          reference,
          applicantName: record.name,
          applicantCountry: record.country,
          riskScore: syntheticRisk(record.id),
          status: "NEW",
        },
      });
      imported += 1;
      await writeAudit(tx, user, {
        app: "kyc",
        entityType: "KycCase",
        entityId: created.id,
        action: `import:${connector.id}`,
        after: { reference, applicantName: created.applicantName, riskScore: created.riskScore },
      });
    }
  });

  revalidatePath("/admin/connectors");
  revalidatePath("/kyc");
  revalidatePath("/admin/audit");
  redirect(`/admin/connectors?imported=${imported}&seen=${records.length}`);
}
