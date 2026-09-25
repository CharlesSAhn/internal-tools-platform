"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FlagEnv } from "@prisma/client";
import { writeAudit } from "@platform/audit";
import { requirePermission } from "@platform/auth";
import { prisma } from "@platform/db";
import {
  CREATE_PERMISSION,
  STALE_STATE_MESSAGE,
  TransitionError,
  VIEW_PERMISSION,
  assertCanChangeEnv,
  assertFresh,
  normalizeRollout,
  parseTargetUserIds,
  transitionAction,
  type FlagEnvName,
} from "./policy";

function backTo(flagId: string, error?: string) {
  redirect(error ? `/flags/${flagId}?error=${encodeURIComponent(error)}` : `/flags/${flagId}?saved=1`);
}

/** The list, the detail page and the audit log all render the state a change touched. */
function revalidateFlag(flagId: string) {
  revalidatePath("/flags");
  revalidatePath(`/flags/${flagId}`);
  revalidatePath("/admin/audit");
}

function message(e: unknown): string {
  if (e instanceof TransitionError) return e.message;
  return e instanceof Error ? e.message : "Unexpected error";
}

type EnvValues = { enabled: boolean; rolloutPercentage: number; targetUserIds: string[] };

/**
 * Reads, authorizes and writes one environment state under optimistic
 * concurrency: the row is re-read inside the transaction and the write is a
 * compare-and-swap on `updatedAt`, so a save that raced a kill switch cannot
 * reinstate the flag or record an audit diff against a snapshot it never saw.
 */
async function applyEnvChange(args: {
  flagId: string;
  env: FlagEnvName;
  expectedUpdatedAt: unknown;
  next: (current: EnvValues) => EnvValues;
  reason: string | null;
  action?: string;
}) {
  const user = await requirePermission(VIEW_PERMISSION);

  await prisma.$transaction(async (tx) => {
    const state = await tx.flagEnvState.findUnique({
      where: { flagId_env: { flagId: args.flagId, env: args.env as FlagEnv } },
    });
    if (!state) throw new TransitionError("Unknown environment state");
    assertFresh(args.expectedUpdatedAt, state.updatedAt);

    const before: EnvValues = {
      enabled: state.enabled,
      rolloutPercentage: state.rolloutPercentage,
      targetUserIds: state.targetUserIds,
    };
    const next = args.next(before);

    assertCanChangeEnv(user, {
      env: args.env,
      currentEnabled: before.enabled,
      nextEnabled: next.enabled,
      reason: args.reason,
    });

    const swapped = await tx.flagEnvState.updateMany({
      where: { id: state.id, updatedAt: state.updatedAt },
      data: next,
    });
    if (swapped.count === 0) throw new TransitionError(STALE_STATE_MESSAGE);

    await writeAudit(tx, user, {
      app: "flags",
      entityType: "FeatureFlag",
      entityId: args.flagId,
      action: args.action ?? transitionAction(args.env, before.enabled, next.enabled),
      reason: args.reason,
      before: { env: args.env, ...before },
      after: { env: args.env, ...next },
    });
  });
}

export async function updateEnvStateAction(formData: FormData) {
  const flagId = String(formData.get("flagId") ?? "");
  const env = String(formData.get("env") ?? "") as FlagEnvName;
  try {
    const reason = String(formData.get("reason") ?? "").trim() || null;
    const next = {
      enabled: formData.get("enabled") === "on",
      rolloutPercentage: normalizeRollout(formData.get("rolloutPercentage")),
      targetUserIds: parseTargetUserIds(formData.get("targetUserIds")),
    };
    await applyEnvChange({
      flagId,
      env,
      expectedUpdatedAt: formData.get("expectedUpdatedAt"),
      next: () => next,
      reason,
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    backTo(flagId, message(e));
  }
  revalidateFlag(flagId);
  backTo(flagId);
}

/** One click, prod off, still permission-checked and still audited. */
export async function killSwitchAction(formData: FormData) {
  const flagId = String(formData.get("flagId") ?? "");
  try {
    await applyEnvChange({
      flagId,
      env: "PROD",
      expectedUpdatedAt: formData.get("expectedUpdatedAt"),
      next: (current) => ({ enabled: false, rolloutPercentage: 0, targetUserIds: current.targetUserIds }),
      reason: "kill switch",
      action: "PROD:kill-switch",
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    backTo(flagId, message(e));
  }
  revalidateFlag(flagId);
  backTo(flagId);
}

export async function setArchivedAction(formData: FormData) {
  const flagId = String(formData.get("flagId") ?? "");
  const archived = formData.get("archived") === "true";
  try {
    const user = await requirePermission(CREATE_PERMISSION);
    const flag = await prisma.featureFlag.findUniqueOrThrow({ where: { id: flagId } });
    await prisma.$transaction(async (tx) => {
      await tx.featureFlag.update({ where: { id: flagId }, data: { archived } });
      await writeAudit(tx, user, {
        app: "flags",
        entityType: "FeatureFlag",
        entityId: flagId,
        action: archived ? "archive" : "unarchive",
        reason: String(formData.get("reason") ?? "").trim() || null,
        before: { archived: flag.archived },
        after: { archived },
      });
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    backTo(flagId, message(e));
  }
  revalidateFlag(flagId);
  backTo(flagId);
}

export async function createFlagAction(formData: FormData) {
  const user = await requirePermission(CREATE_PERMISSION);
  const key = String(formData.get("key") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const ownerEmail = String(formData.get("ownerEmail") ?? "").trim();

  let flagId: string;
  try {
    if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(key))
      throw new TransitionError("Key must look like area.flag_name (lowercase, dot-separated)");
    if (!description) throw new TransitionError("Description is required");
    if (!ownerEmail.includes("@")) throw new TransitionError("Owner must be an email address");
    if (await prisma.featureFlag.findUnique({ where: { key } }))
      throw new TransitionError(`Flag "${key}" already exists`);

    flagId = await prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.create({
        data: {
          key,
          description,
          ownerEmail,
          envStates: {
            create: (["DEV", "STAGING", "PROD"] as const).map((env) => ({ env })),
          },
        },
      });
      await writeAudit(tx, user, {
        app: "flags",
        entityType: "FeatureFlag",
        entityId: flag.id,
        action: "create",
        before: null,
        after: { key, description, ownerEmail, archived: false, envStates: "all environments off" },
      });
      return flag.id;
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    redirect(`/flags/new?error=${encodeURIComponent(message(e))}`);
  }
  revalidateFlag(flagId);
  redirect(`/flags/${flagId}`);
}

function isRedirect(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}
