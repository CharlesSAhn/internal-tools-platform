"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@platform/auth";
import { writeAudit } from "@platform/audit";
import { getConnector } from "@platform/connectors";
import { prisma } from "@platform/db";
import {
  CONNECTORS_PERMISSION,
  DEFAULT_MAPPING,
  defaultMappingRows,
  ensureMappingRows,
  isTargetField,
  isValidTemplate,
  NO_SOURCE,
} from "../../import";

function schemaPath(source: string, error?: string) {
  return `/admin/connectors/${source}/schema${error ? `?error=${encodeURIComponent(error)}` : ""}`;
}

async function guard(formData: FormData) {
  const source = String(formData.get("source") ?? "");
  const user = await requirePermission(CONNECTORS_PERMISSION);
  const connector = getConnector(source);
  if (!connector) redirect(`/admin/connectors?error=${encodeURIComponent("Unknown connector")}`);
  return { source, user, connector };
}

function done(source: string) {
  revalidatePath(schemaPath(source));
  revalidatePath("/admin/audit");
  redirect(schemaPath(source));
}

export async function saveMappingAction(formData: FormData) {
  const { source, user, connector } = await guard(formData);
  const targetField = formData.get("targetField");
  const sourceField = String(formData.get("sourceField") ?? "").trim();
  if (!isTargetField(targetField)) redirect(schemaPath(source, "Unknown field"));
  if (!isValidTemplate(sourceField, connector.fields)) {
    redirect(schemaPath(source, `Template must use only {path} tokens from: ${connector.fields.join(", ")}`));
  }

  await setSource(source, user, targetField, sourceField, "mapping.save");
  done(source);
}

/** "Delete" keeps the row and blanks its source, so the unmapped choice survives reloads and reseeds. */
export async function deleteMappingAction(formData: FormData) {
  const { source, user } = await guard(formData);
  const targetField = formData.get("targetField");
  if (!isTargetField(targetField)) redirect(schemaPath(source, "Unknown field"));

  await setSource(source, user, targetField, NO_SOURCE, "mapping.delete");
  done(source);
}

async function setSource(
  source: string,
  user: Awaited<ReturnType<typeof requirePermission>>,
  targetField: string,
  sourceField: string,
  action: "mapping.save" | "mapping.delete",
) {
  await prisma.$transaction(async (tx) => {
    const rows = await ensureMappingRows(tx, source);
    const before = rows.find((r) => r.targetField === targetField);
    const row = await tx.sourceMapping.upsert({
      where: { source_targetField: { source, targetField } },
      create: { source, targetField, sourceField },
      update: { sourceField },
    });
    await writeAudit(tx, user, {
      app: "admin",
      entityType: "SourceMapping",
      entityId: row.id,
      action,
      before: before ? { source, targetField, sourceField: before.sourceField } : undefined,
      after: { source, targetField, sourceField },
    });
  });
}

export async function resetMappingAction(formData: FormData) {
  const { source, user } = await guard(formData);

  await prisma.$transaction(async (tx) => {
    const before = await tx.sourceMapping.findMany({ where: { source } });
    await tx.sourceMapping.deleteMany({ where: { source } });
    await tx.sourceMapping.createMany({ data: defaultMappingRows(source) });
    await writeAudit(tx, user, {
      app: "admin",
      entityType: "SourceMapping",
      entityId: source,
      action: "mapping.reset",
      before: Object.fromEntries(before.map((r) => [r.targetField, r.sourceField])),
      after: DEFAULT_MAPPING,
    });
  });
  done(source);
}
