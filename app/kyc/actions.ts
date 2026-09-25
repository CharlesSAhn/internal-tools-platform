"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@platform/auth";
import { prisma } from "@platform/db";
import { writeAudit } from "@platform/audit";
import { resolveTransition, TransitionError } from "@platform/workflow";
import { kycMachine, type KycStatusValue } from "./workflow";

/** Fields whose before/after we record in the audit row. */
type AuditableFields = {
  status: KycStatusValue;
  assigneeId: string | null;
  lastEscalatedById: string | null;
};

export async function transitionCaseAction(formData: FormData) {
  const caseId = String(formData.get("caseId") ?? "");
  const action = String(formData.get("action") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;

  // The button is hidden without permission, but hiding is never the enforcement.
  const user = await requirePermission("kyc.app.view");

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.kycCase.findUnique({ where: { id: caseId } });
      if (!current) throw new TransitionError("Case not found");

      const entity = {
        id: current.id,
        status: current.status as KycStatusValue,
        riskScore: current.riskScore,
        assigneeId: current.assigneeId,
        lastEscalatedById: current.lastEscalatedById,
      };
      const transition = resolveTransition(kycMachine, {
        current: entity.status,
        action,
        user,
        entity,
        reason,
      });

      const before: AuditableFields = {
        status: entity.status,
        assigneeId: entity.assigneeId,
        lastEscalatedById: entity.lastEscalatedById,
      };
      const after: AuditableFields = {
        status: transition.to,
        assigneeId:
          action === "claim" ? user.id : action === "escalate" ? null : entity.assigneeId,
        lastEscalatedById: action === "escalate" ? user.id : entity.lastEscalatedById,
      };

      const updated = await tx.kycCase.updateMany({
        where: { id: caseId, status: entity.status, assigneeId: entity.assigneeId },
        data: after,
      });
      if (updated.count === 0)
        throw new TransitionError("This case changed while you were viewing it — reload and try again");

      await writeAudit(tx, user, {
        app: "kyc",
        entityType: "KycCase",
        entityId: caseId,
        action: `case.${action}`,
        reason,
        before,
        after,
      });
    });
  } catch (e) {
    const message = e instanceof TransitionError || e instanceof Error ? e.message : "Unexpected error";
    redirect(`/kyc/${caseId}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/kyc");
  revalidatePath(`/kyc/${caseId}`);
  revalidatePath("/admin/audit");
  redirect(`/kyc/${caseId}`);
}
