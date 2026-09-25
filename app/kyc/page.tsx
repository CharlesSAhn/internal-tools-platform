import { requirePermission } from "@platform/auth";
import { Card, PageHeader } from "@platform/ui";

export default async function KycPlaceholderPage() {
  await requirePermission("kyc.app.view");
  return (
    <>
      <PageHeader title="KYC Review" subtitle="Placeholder — implemented by the KYC app session." />
      <Card>
        <p className="text-sm text-slate-600">Coming next: queue, case detail, decisions, audit timeline.</p>
      </Card>
    </>
  );
}
