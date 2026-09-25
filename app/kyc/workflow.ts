import { defineMachine } from "@platform/workflow";
import { enforceFourEyes } from "@platform/rbac";
import type { SessionUser } from "@platform/auth/session";

export type KycStatusValue = "NEW" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "ESCALATED";

/** The slice of a case the workflow guards need — keeps the machine testable without a DB. */
export type KycCaseEntity = {
  id: string;
  status: KycStatusValue;
  riskScore: number;
  assigneeId: string | null;
  lastEscalatedById: string | null;
};

export const HIGH_RISK_THRESHOLD = 80;
export const HIGH_RISK_PERMISSION = "kyc.case.approve.high_risk";

function assigneeOnly({ user, entity }: { user: SessionUser; entity: KycCaseEntity }): string | void {
  if (entity.assigneeId !== user.id) return "Only the assignee can decide this case";
}

function highRiskGuard({ user, entity }: { user: SessionUser; entity: KycCaseEntity }): string | void {
  if (entity.riskScore >= HIGH_RISK_THRESHOLD && !user.permissions.includes(HIGH_RISK_PERMISSION))
    return `Risk score ${entity.riskScore} requires the ${HIGH_RISK_PERMISSION} permission`;
}

function fourEyes({ user, entity }: { user: SessionUser; entity: KycCaseEntity }): string | void {
  try {
    enforceFourEyes(user.id, entity.lastEscalatedById);
  } catch (e) {
    return e instanceof Error ? e.message : "Four-eyes violation";
  }
}

function seniorOnly({ user }: { user: SessionUser }): string | void {
  if (!user.permissions.includes(HIGH_RISK_PERMISSION))
    return `Deciding an escalated case requires the ${HIGH_RISK_PERMISSION} permission`;
}

export const kycMachine = defineMachine<KycStatusValue, KycCaseEntity>({
  name: "kyc.case",
  transitions: [
    { from: "NEW", to: "IN_REVIEW", action: "claim", permission: "kyc.case.claim" },
    {
      from: "IN_REVIEW",
      to: "APPROVED",
      action: "approve",
      permission: "kyc.case.decide",
      guard: (ctx) => assigneeOnly(ctx) || highRiskGuard(ctx),
    },
    {
      from: "IN_REVIEW",
      to: "REJECTED",
      action: "reject",
      permission: "kyc.case.decide",
      requiresReason: true,
      guard: assigneeOnly,
    },
    {
      from: "IN_REVIEW",
      to: "ESCALATED",
      action: "escalate",
      permission: "kyc.case.decide",
      requiresReason: true,
      guard: assigneeOnly,
    },
    { from: "ESCALATED", to: "IN_REVIEW", action: "claim", permission: "kyc.case.claim", guard: fourEyes },
    {
      from: "ESCALATED",
      to: "APPROVED",
      action: "approve",
      permission: "kyc.case.decide",
      guard: (ctx) => seniorOnly(ctx) || fourEyes(ctx),
    },
    {
      from: "ESCALATED",
      to: "REJECTED",
      action: "reject",
      permission: "kyc.case.decide",
      requiresReason: true,
      guard: (ctx) => seniorOnly(ctx) || fourEyes(ctx),
    },
  ],
});

export const ACTION_LABELS: Record<string, string> = {
  claim: "Claim",
  approve: "Approve",
  reject: "Reject",
  escalate: "Escalate",
};

export function riskBand(score: number): "low" | "medium" | "high" {
  if (score >= HIGH_RISK_THRESHOLD) return "high";
  if (score >= 40) return "medium";
  return "low";
}
