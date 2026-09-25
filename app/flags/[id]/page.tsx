import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditTimeline } from "@platform/ui/audit-timeline";
import { requirePermission } from "@platform/auth";
import { prisma } from "@platform/db";
import { can } from "@platform/rbac";
import { Badge, Button, Card, ErrorText, Field, PageHeader, inputClass } from "@platform/ui";
import { killSwitchAction, setArchivedAction, updateEnvStateAction } from "../actions";
import { EnvSummary } from "../env-summary";
import {
  CREATE_PERMISSION,
  ENVS,
  VIEW_PERMISSION,
  canChangeEnv,
  requiresReason,
  writePermission,
  type FlagEnvName,
} from "../policy";

export default async function FlagDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await requirePermission(VIEW_PERMISSION);
  const { id } = await params;
  const sp = await searchParams;
  const flag = await prisma.featureFlag.findUnique({ where: { id }, include: { envStates: true } });
  if (!flag) notFound();

  const prod = flag.envStates.find((s) => s.env === "PROD");
  const canKill = prod ? canChangeEnv(user, { env: "PROD", currentEnabled: prod.enabled, nextEnabled: false, reason: "kill switch" }) === null : false;

  return (
    <>
      <PageHeader
        title={flag.key}
        subtitle={`${flag.description} · owner ${flag.ownerEmail}`}
        actions={
          <>
            <Link href="/flags" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              Back
            </Link>
            {can(user, CREATE_PERMISSION) ? (
              <form action={setArchivedAction}>
                <input type="hidden" name="flagId" value={flag.id} />
                <input type="hidden" name="archived" value={flag.archived ? "false" : "true"} />
                <Button type="submit" variant="secondary">
                  {flag.archived ? "Unarchive" : "Archive"}
                </Button>
              </form>
            ) : null}
          </>
        }
      />

      {sp.error ? <ErrorText>{sp.error}</ErrorText> : null}
      {sp.saved ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Change saved and audited.</p> : null}
      {flag.archived ? <Badge tone="warning">archived</Badge> : null}

      {prod ? (
        <Card title="Production kill switch">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-600">
              Disables this flag in production immediately, at 0% rollout. Audited with the reason “kill switch”.
            </p>
            <form action={killSwitchAction}>
              <input type="hidden" name="flagId" value={flag.id} />
              <Button type="submit" variant="danger" disabled={!canKill || !prod.enabled}>
                Kill in production
              </Button>
            </form>
          </div>
          {!canKill ? (
            <p className="mt-2 text-xs text-rose-700">You need <span className="font-mono">flags.write.prod</span> to use the kill switch.</p>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {ENVS.map((env: FlagEnvName) => {
          const state = flag.envStates.find((s) => s.env === env);
          if (!state) return null;
          const denial = canChangeEnv(user, {
            env,
            currentEnabled: state.enabled,
            nextEnabled: state.enabled,
            reason: requiresReason(env) ? "probe" : null,
          });
          const editable = denial === null;
          return (
            <Card key={env} title={env.toLowerCase()}>
              <div className="mb-3 flex items-center justify-between">
                <EnvSummary state={state} />
                <span className="font-mono text-xs text-slate-400">{writePermission(env)}</span>
              </div>
              {!editable ? (
                <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {env === "PROD"
                    ? "Production changes require the flags.write.prod permission. Your roles do not grant it."
                    : denial}
                </p>
              ) : null}
              <form action={updateEnvStateAction} className="space-y-3">
                <input type="hidden" name="flagId" value={flag.id} />
                <input type="hidden" name="env" value={env} />
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="enabled" defaultChecked={state.enabled} disabled={!editable} />
                  Enabled
                </label>
                <Field label="Rollout %">
                  <input
                    className={inputClass}
                    type="number"
                    min={0}
                    max={100}
                    name="rolloutPercentage"
                    defaultValue={state.rolloutPercentage}
                    disabled={!editable}
                  />
                </Field>
                <Field label="Target user IDs" hint="Comma or space separated; always on for these users.">
                  <input
                    className={inputClass}
                    name="targetUserIds"
                    defaultValue={state.targetUserIds.join(", ")}
                    disabled={!editable}
                  />
                </Field>
                <Field label={requiresReason(env) ? "Change reason (required)" : "Change reason (optional)"}>
                  <input className={inputClass} name="reason" disabled={!editable} required={requiresReason(env)} />
                </Field>
                <Button type="submit" disabled={!editable}>
                  Save {env.toLowerCase()}
                </Button>
              </form>
            </Card>
          );
        })}
      </div>

      <Card title="Change history">
        <AuditTimeline app="flags" entityType="FeatureFlag" entityId={flag.id} />
      </Card>
    </>
  );
}
