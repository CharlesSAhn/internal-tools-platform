import { defineApp } from "@platform/registry/types";

export const kycApp = defineApp({
  id: "kyc",
  name: "KYC Review",
  description: "Review queue for customer onboarding cases",
  viewPermission: "kyc.app.view",
  permissions: [
    { key: "kyc.app.view", description: "See the KYC queue" },
    { key: "kyc.case.claim", description: "Claim a case for review" },
    { key: "kyc.case.decide", description: "Approve, reject or escalate a case" },
    { key: "kyc.case.approve.high_risk", description: "Approve cases with risk score >= 80" },
  ],
  nav: [{ label: "KYC Review", href: "/kyc" }],
});
