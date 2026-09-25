import { describe, expect, it } from "vitest";
import { availableTransitions, resolveTransition, TransitionError } from "@platform/workflow";
import type { SessionUser } from "@platform/auth/session";
import { kycMachine, riskBand, type KycCaseEntity, type KycStatusValue } from "./workflow";

const REVIEWER_PERMS = ["kyc.app.view", "kyc.case.claim", "kyc.case.decide"];
const SENIOR_PERMS = [...REVIEWER_PERMS, "kyc.case.approve.high_risk"];

function user(id: string, permissions: string[] = REVIEWER_PERMS): SessionUser {
  return { id, email: `${id}@example.com`, name: id, roles: [], permissions };
}

function kycCase(overrides: Partial<KycCaseEntity> = {}): KycCaseEntity {
  return { id: "case-1", status: "NEW", riskScore: 20, assigneeId: null, lastEscalatedById: null, ...overrides };
}

function resolve(
  entity: KycCaseEntity,
  action: string,
  actor: SessionUser,
  reason?: string,
) {
  return resolveTransition(kycMachine, {
    current: entity.status as KycStatusValue,
    action,
    user: actor,
    entity,
    reason,
  });
}

describe("kyc workflow", () => {
  it("claims a new case into review", () => {
    expect(resolve(kycCase(), "claim", user("riley")).to).toBe("IN_REVIEW");
  });

  it("rejects an action that is illegal from the current state", () => {
    expect(() => resolve(kycCase({ status: "APPROVED" }), "claim", user("riley"))).toThrow(TransitionError);
    expect(() => resolve(kycCase(), "approve", user("riley"))).toThrow(/not allowed from state "NEW"/);
  });

  it("requires the claim permission", () => {
    expect(() => resolve(kycCase(), "claim", user("quinn", ["kyc.app.view"]))).toThrow(/kyc.case.claim/);
  });

  it("lets the assignee approve a standard-risk case", () => {
    const c = kycCase({ status: "IN_REVIEW", assigneeId: "riley", riskScore: 42 });
    expect(resolve(c, "approve", user("riley")).to).toBe("APPROVED");
  });

  it("blocks a non-assignee from deciding", () => {
    const c = kycCase({ status: "IN_REVIEW", assigneeId: "riley" });
    expect(() => resolve(c, "approve", user("sam", SENIOR_PERMS))).toThrow(/Only the assignee/);
    expect(() => resolve(c, "reject", user("sam", SENIOR_PERMS), "bad docs")).toThrow(/Only the assignee/);
  });

  it("requires the senior permission to approve a high-risk case", () => {
    const c = kycCase({ status: "IN_REVIEW", assigneeId: "riley", riskScore: 88 });
    expect(() => resolve(c, "approve", user("riley"))).toThrow(/kyc.case.approve.high_risk/);
    expect(resolve({ ...c, assigneeId: "sam" }, "approve", user("sam", SENIOR_PERMS)).to).toBe("APPROVED");
  });

  it("requires a reason to reject or escalate", () => {
    const c = kycCase({ status: "IN_REVIEW", assigneeId: "riley" });
    expect(() => resolve(c, "reject", user("riley"))).toThrow(/reason is required/);
    expect(() => resolve(c, "escalate", user("riley"), "   ")).toThrow(/reason is required/);
    expect(resolve(c, "escalate", user("riley"), "sanctions hit").to).toBe("ESCALATED");
  });

  it("enforces four-eyes when re-claiming an escalated case", () => {
    const c = kycCase({ status: "ESCALATED", assigneeId: null, lastEscalatedById: "riley" });
    expect(() => resolve(c, "claim", user("riley"))).toThrow(/Four-eyes/);
    expect(resolve(c, "claim", user("sam", SENIOR_PERMS)).to).toBe("IN_REVIEW");
  });

  it("only lets a senior decide an escalated case", () => {
    const c = kycCase({ status: "ESCALATED", riskScore: 30, lastEscalatedById: "riley" });
    expect(() => resolve(c, "approve", user("dana"))).toThrow(/kyc.case.approve.high_risk/);
    expect(resolve(c, "approve", user("sam", SENIOR_PERMS)).to).toBe("APPROVED");
  });

  it("offers only the transitions the user may actually perform", () => {
    const highRisk = kycCase({ status: "IN_REVIEW", assigneeId: "riley", riskScore: 91 });
    expect(availableTransitions(kycMachine, "IN_REVIEW", user("riley"), highRisk).map((t) => t.action)).toEqual([
      "reject",
      "escalate",
    ]);
    expect(availableTransitions(kycMachine, "IN_REVIEW", user("nobody", ["kyc.app.view"]), highRisk)).toEqual([]);
    const escalated = kycCase({ status: "ESCALATED", lastEscalatedById: "riley" });
    expect(availableTransitions(kycMachine, "ESCALATED", user("riley"), escalated)).toEqual([]);
  });

  it("bands risk scores for the queue filters", () => {
    expect([riskBand(12), riskBand(40), riskBand(79), riskBand(80)]).toEqual(["low", "medium", "medium", "high"]);
  });
});
