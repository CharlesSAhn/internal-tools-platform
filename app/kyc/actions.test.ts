import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/test/next-mocks")).headersModule);
vi.mock("next/navigation", async () => (await import("@/test/next-mocks")).navigationModule);
vi.mock("next/cache", async () => (await import("@/test/next-mocks")).cacheModule);

import { prisma } from "@platform/db";
import { captureRedirect, formData } from "@/test/next-mocks";
import { auditFor, cleanupFixtures, makeCase, makeUser, signIn, signOut } from "@/test/fixtures";
import { transitionCaseAction } from "./actions";
import { HIGH_RISK_PERMISSION, HIGH_RISK_THRESHOLD } from "./workflow";

const VIEW = "kyc.app.view";
const CLAIM = "kyc.case.claim";
const DECIDE = "kyc.case.decide";

async function analyst() {
  return makeUser([VIEW, CLAIM, DECIDE], "analyst");
}

async function senior() {
  return makeUser([VIEW, CLAIM, DECIDE, HIGH_RISK_PERMISSION], "senior");
}

async function caseStatus(id: string) {
  return prisma.kycCase.findUniqueOrThrow({ where: { id } });
}

beforeEach(() => {
  signOut();
});

afterAll(async () => {
  await cleanupFixtures();
});

describe("transitionCaseAction access control", () => {
  it("sends an anonymous caller to the login page", async () => {
    const kycCase = await makeCase();
    const redirected = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "claim" })),
    );
    expect(redirected.path).toBe("/login");
    expect((await caseStatus(kycCase.id)).status).toBe("NEW");
  });

  it("sends a caller without kyc.app.view to the forbidden page", async () => {
    await signIn((await makeUser(["flags.app.view"], "outsider")).id);
    const kycCase = await makeCase();
    const redirected = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "claim" })),
    );
    expect(redirected.path).toBe("/forbidden");
    expect(redirected.params.get("p")).toBe(VIEW);
  });

  it("rejects a viewer who lacks the transition permission", async () => {
    await signIn((await makeUser([VIEW], "readonly")).id);
    const kycCase = await makeCase();
    const redirected = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "claim" })),
    );
    expect(redirected.error).toBe(`Missing permission: ${CLAIM}`);
    expect((await caseStatus(kycCase.id)).status).toBe("NEW");
    expect(await auditFor(kycCase.id)).toHaveLength(0);
  });
});

describe("transitionCaseAction happy paths", () => {
  it("claims a new case, assigns it and audits the change", async () => {
    const user = await analyst();
    await signIn(user.id);
    const kycCase = await makeCase();

    const redirected = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "claim" })),
    );

    expect(redirected.path).toBe(`/kyc/${kycCase.id}`);
    expect(await caseStatus(kycCase.id)).toMatchObject({ status: "IN_REVIEW", assigneeId: user.id });

    const audit = await auditFor(kycCase.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ app: "kyc", entityType: "KycCase", action: "case.claim", actorId: user.id });
    expect(audit[0].before).toMatchObject({ status: "NEW", assigneeId: null });
    expect(audit[0].after).toMatchObject({ status: "IN_REVIEW", assigneeId: user.id });
  });

  it("approves a low-risk case the caller owns", async () => {
    const user = await analyst();
    await signIn(user.id);
    const kycCase = await makeCase({ status: "IN_REVIEW", assigneeId: user.id, riskScore: 10 });

    await captureRedirect(() => transitionCaseAction(formData({ caseId: kycCase.id, action: "approve" })));

    expect((await caseStatus(kycCase.id)).status).toBe("APPROVED");
    expect((await auditFor(kycCase.id))[0].action).toBe("case.approve");
  });

  it("rejects a case with a reason and stores the reason", async () => {
    const user = await analyst();
    await signIn(user.id);
    const kycCase = await makeCase({ status: "IN_REVIEW", assigneeId: user.id });

    await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "reject", reason: "documents forged" })),
    );

    expect((await caseStatus(kycCase.id)).status).toBe("REJECTED");
    expect((await auditFor(kycCase.id))[0]).toMatchObject({ action: "case.reject", reason: "documents forged" });
  });

  it("escalates and clears the assignee while recording the escalator", async () => {
    const user = await analyst();
    await signIn(user.id);
    const kycCase = await makeCase({ status: "IN_REVIEW", assigneeId: user.id });

    await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "escalate", reason: "needs senior eyes" })),
    );

    expect(await caseStatus(kycCase.id)).toMatchObject({
      status: "ESCALATED",
      assigneeId: null,
      lastEscalatedById: user.id,
    });
  });
});

describe("transitionCaseAction guards", () => {
  it("blocks a decision by someone other than the assignee", async () => {
    const owner = await analyst();
    const other = await analyst();
    await signIn(other.id);
    const kycCase = await makeCase({ status: "IN_REVIEW", assigneeId: owner.id });

    const redirected = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "approve" })),
    );

    expect(redirected.error).toBe("Only the assignee can decide this case");
    expect((await caseStatus(kycCase.id)).status).toBe("IN_REVIEW");
    expect(await auditFor(kycCase.id)).toHaveLength(0);
  });

  it("requires a reason to reject or escalate", async () => {
    const user = await analyst();
    await signIn(user.id);
    const kycCase = await makeCase({ status: "IN_REVIEW", assigneeId: user.id });

    const rejected = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "reject", reason: "   " })),
    );
    expect(rejected.error).toBe("A reason is required for this action");

    const escalated = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "escalate" })),
    );
    expect(escalated.error).toBe("A reason is required for this action");

    expect((await caseStatus(kycCase.id)).status).toBe("IN_REVIEW");
    expect(await auditFor(kycCase.id)).toHaveLength(0);
  });

  it("blocks approving a high-risk case without the high-risk permission", async () => {
    const user = await analyst();
    await signIn(user.id);
    const kycCase = await makeCase({
      status: "IN_REVIEW",
      assigneeId: user.id,
      riskScore: HIGH_RISK_THRESHOLD,
    });

    const redirected = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "approve" })),
    );

    expect(redirected.error).toBe(
      `Risk score ${HIGH_RISK_THRESHOLD} requires the ${HIGH_RISK_PERMISSION} permission`,
    );
    expect((await caseStatus(kycCase.id)).status).toBe("IN_REVIEW");
  });

  it("allows approving just below the high-risk threshold", async () => {
    const user = await analyst();
    await signIn(user.id);
    const kycCase = await makeCase({
      status: "IN_REVIEW",
      assigneeId: user.id,
      riskScore: HIGH_RISK_THRESHOLD - 1,
    });

    await captureRedirect(() => transitionCaseAction(formData({ caseId: kycCase.id, action: "approve" })));

    expect((await caseStatus(kycCase.id)).status).toBe("APPROVED");
  });

  it("allows a senior reviewer to approve a high-risk case", async () => {
    const user = await senior();
    await signIn(user.id);
    const kycCase = await makeCase({ status: "IN_REVIEW", assigneeId: user.id, riskScore: 99 });

    await captureRedirect(() => transitionCaseAction(formData({ caseId: kycCase.id, action: "approve" })));

    expect((await caseStatus(kycCase.id)).status).toBe("APPROVED");
  });

  it("stops the escalator from claiming the case back (four eyes)", async () => {
    const user = await analyst();
    await signIn(user.id);
    const kycCase = await makeCase({ status: "ESCALATED", lastEscalatedById: user.id });

    const redirected = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "claim" })),
    );

    expect(redirected.error).toBe("Four-eyes violation: you cannot approve an action you initiated");
    expect((await caseStatus(kycCase.id)).status).toBe("ESCALATED");
  });

  it("requires seniority to decide an escalated case", async () => {
    const escalator = await analyst();
    const reviewer = await analyst();
    await signIn(reviewer.id);
    const kycCase = await makeCase({ status: "ESCALATED", lastEscalatedById: escalator.id });

    const redirected = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "approve" })),
    );

    expect(redirected.error).toBe(
      `Deciding an escalated case requires the ${HIGH_RISK_PERMISSION} permission`,
    );
  });
});

describe("transitionCaseAction invalid input", () => {
  it("rejects an unknown case id", async () => {
    await signIn((await analyst()).id);
    const redirected = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: "does-not-exist", action: "claim" })),
    );
    expect(redirected.path).toBe("/kyc/does-not-exist");
    expect(redirected.error).toBe("Case not found");
  });

  it("rejects an unknown action", async () => {
    await signIn((await analyst()).id);
    const kycCase = await makeCase();
    const redirected = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "bogus" })),
    );
    expect(redirected.error).toBe('Action "bogus" is not allowed from state "NEW"');
  });

  it("rejects an action that is legal but not from the current state", async () => {
    const user = await analyst();
    await signIn(user.id);
    const kycCase = await makeCase({ status: "APPROVED", assigneeId: user.id });

    const redirected = await captureRedirect(() =>
      transitionCaseAction(formData({ caseId: kycCase.id, action: "approve" })),
    );

    expect(redirected.error).toBe('Action "approve" is not allowed from state "APPROVED"');
    expect(await auditFor(kycCase.id)).toHaveLength(0);
  });

  it("rejects a missing action with an empty caseId redirect target", async () => {
    await signIn((await analyst()).id);
    const redirected = await captureRedirect(() => transitionCaseAction(formData({ caseId: "", action: "" })));
    expect(redirected.error).toBe("Case not found");
  });
});
