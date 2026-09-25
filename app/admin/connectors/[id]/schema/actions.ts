"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@platform/auth";
import { writeAudit } from "@platform/audit";
import { getConnector } from "@platform/connectors";
import { prisma } from "@platform/db";
import { CONNECTORS_PERMISSION, DEFAULT_MAPPING, isSourceField, isTargetField, TARGET_FIELDS } from "../../import";

function schemaPath(source: string, error?: string) {
  return `/admin/connectors/${source}/schema${error ? `?error=${encodeURIComponent(error)}` : ""}`;
}

async function guard(formData: FormData) {
  const source = String(formData.get("source") ?? "");
  const user = await requirePermission(CONNECTORS_PERMISSION);
  if (!getConnector(source)) redirect(`/admin/connectors?error=${encodeURIComponent("Unknown connector")}`);
  return { source, user };
}

function done(source: string) {
  revalidatePath(schemaPath(source));
  revalidatePath("/admin/audit");
  redirect(schemaPath(source));
}

export async function saveMappingAction(formData: FormData) {
  const { source, user } = await guard(formData);
  const targetField = formData.get("targetField");
  const sourceField = formData.get("sourceField");
  if (!isTargetField(targetField) || !isSourceField(sourceField)) {
    redirect(schemaPath(source, "Unknown field"));
  }

  await prisma.$transaction(async (tx) => {
    const before = await tx.sourceMapping.findUnique({ where: { source_targetField: { source, targetField } } });
    const row = await tx.sourceMapping.upsert({
      where: { source_targetField: { source, targetField } },
      create: { source, targetField, sourceField },
      update: { sourceField },
    });
    await writeAudit(tx, user, {
      app: "admin",
      entityType: "SourceMapping",
      entityId: row.id,
      action: "mapping.save",
      before: before ? { source, targetField, sourceField: before.sourceField } : undefined,
      after: { source, targetField, sourceField },
    });
  });
  done(source);
}

export async function deleteMappingAction(formData: FormData) {
  const { source, user } = await guard(formData);
  const targetField = formData.get("targetField");
  if (!isTargetField(targetField)) redirect(schemaPath(source, "Unknown field"));

  await prisma.$transaction(async (tx) => {
    const row = await tx.sourceMapping.findUnique({ where: { source_targetField: { source, targetField } } });
    if (!row) return;
    await tx.sourceMapping.delete({ where: { id: row.id } });
    await writeAudit(tx, user, {
      app: "admin",
      entityType: "SourceMapping",
      entityId: row.id,
      action: "mapping.delete",
      before: { source, targetField, sourceField: row.sourceField },
    });
  });
  done(source);
}

export async function resetMappingAction(formData: FormData) {
  const { source, user } = await guard(formData);

  await prisma.$transaction(async (tx) => {
    const before = await tx.sourceMapping.findMany({ where: { source } });
    await tx.sourceMapping.deleteMany({ where: { source } });
    await tx.sourceMapping.createMany({
      data: TARGET_FIELDS.map((t) => ({ source, targetField: t, sourceField: DEFAULT_MAPPING[t] })),
    });
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
