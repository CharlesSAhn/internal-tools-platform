import { requirePermission } from "@platform/auth";
import { Card, PageHeader } from "@platform/ui";

export default async function FlagsPlaceholderPage() {
  await requirePermission("flags.app.view");
  return (
    <>
      <PageHeader title="Feature Flags" subtitle="Placeholder — implemented by the feature-flag app session." />
      <Card>
        <p className="text-sm text-slate-600">Coming next: flag list, per-environment state, prod guardrails, read API.</p>
      </Card>
    </>
  );
}
