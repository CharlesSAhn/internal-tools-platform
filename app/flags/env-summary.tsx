import { Badge } from "@platform/ui";

export type EnvSummaryState = {
  enabled: boolean;
  rolloutPercentage: number;
  targetUserIds: string[];
} | null;

/** off / on / 25% — the at-a-glance state of one environment. */
export function EnvSummary({ state }: { state: EnvSummaryState }) {
  if (!state) return <span className="text-xs text-slate-400">—</span>;
  if (!state.enabled) return <Badge tone="neutral">off</Badge>;
  const label = state.rolloutPercentage >= 100 ? "on" : `${state.rolloutPercentage}%`;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={state.rolloutPercentage >= 100 ? "success" : "info"}>{label}</Badge>
      {state.targetUserIds.length > 0 ? (
        <span className="text-xs text-slate-500">+{state.targetUserIds.length}</span>
      ) : null}
    </span>
  );
}
