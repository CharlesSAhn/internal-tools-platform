import { requirePermission } from "@platform/auth";
import { Button, Card, ErrorText, Field, PageHeader, inputClass } from "@platform/ui";
import { createFlagAction } from "../actions";
import { CREATE_PERMISSION } from "../policy";

export default async function NewFlagPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePermission(CREATE_PERMISSION);
  const { error } = await searchParams;
  return (
    <>
      <PageHeader title="New feature flag" subtitle="Created with all three environments off." />
      <ErrorText>{error}</ErrorText>
      <Card className="max-w-xl">
        <form action={createFlagAction} className="space-y-4">
          <Field label="Key" hint="area.flag_name, e.g. checkout.new_pricing">
            <input className={inputClass} name="key" required placeholder="checkout.new_pricing" />
          </Field>
          <Field label="Description">
            <input className={inputClass} name="description" required />
          </Field>
          <Field label="Owner email">
            <input className={inputClass} type="email" name="ownerEmail" required />
          </Field>
          <Button type="submit">Create flag</Button>
        </form>
      </Card>
    </>
  );
}
