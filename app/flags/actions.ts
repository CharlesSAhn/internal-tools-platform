"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FlagEnv } from "@prisma/client";
import { writeAudit } from "@platform/audit";
import { requirePermission } from "@platform/auth";
import { prisma } from "@platform/db";
import {
  CREATE_PERMISSION,
  TransitionError,
  VIEW_PERMISSION,
  assertCanChangeEnv,
  normalizeRollout,
  parseTargetUserIds,
  transitionAction,
  type FlagEnvName,
} from "./policy";

const STALE_MESSAGE = "This flag changed while you were editing it — reload and try again";

function backTo(flagId: string, error?: string) {
  redirect(error ? `/flags/${flagId}?error=${encodeURIComponent(error)}` : `/flags/${flagId}?saved=1`);
}

function message(e: unknown): string {
  if (e instanceof TransitionError) return e.message;
  return e instanceof Error ? e.message : "Unexpected error";
}

async function applyEnvChange(args: {
  flagId: string;
  env: FlagEnvName;
  next: { enabled: boolean; rolloutPercentage: number; targetUserIds: string[] };
  reason: string | null;
  /** `updatedAt` of the state the form was rendered from, when the caller submitted a form. */
  renderedAt?: Date | null;
  /** Named from the state read inside the transaction, not from the rendered form. */
  action: (currentEnabled: boolean) => string;
}) {
  const user = await requirePermission(VIEW_PERMISSION);

  await prisma.$transaction(async (tx) => {
    const state = await tx.flagEnvState.findFirst({
      where: { flagId: args.flagId, env: args.env as FlagEnv },
    });
    if (!state) throw new TransitionError("Unknown environment state");
    if (args.renderedAt && args.renderedAt.getTime() !== state.updatedAt.getTime())
      throw new TransitionError(STALE_MESSAGE);

    assertCanChangeEnv(user, {
      env: args.env,
      currentEnabled: state.enabled,
      nextEnabled: args.next.enabled,
      reason: args.reason,
    });

    const before = {
      enabled: state.enabled,
      rolloutPercentage: state.rolloutPercentage,
      targetUserIds: state.targetUserIds,
    };

    const updated = await tx.flagEnvState.updateMany({
      where: { id: state.id, updatedAt: state.updatedAt },
      data: args.next,
    });
    if (updated.count === 0) throw new TransitionError(STALE_MESSAGE);

    await writeAudit(tx, user, {
      app: "flags",
      entityType: "FeatureFlag",
      entityId: args.flagId,
      action: args.action(state.enabled),
      reason: args.reason,
      before: { env: args.env, ...before },
      after: { env: args.env, ...args.next },
    });
  });
}

export async function updateEnvStateAction(formData: FormData) {
  const flagId = String(formData.get("flagId") ?? "");
  const env = String(formData.get("env") ?? "") as FlagEnvName;
  try {
    const reason = String(formData.get("reason") ?? "").trim() || null;
    const enabled = formData.get("enabled") === "on";
    const rendered = String(formData.get("renderedAt") ?? "");
    const next = {
      enabled,
      rolloutPercentage: normalizeRollout(formData.get("rolloutPercentage")),
      targetUserIds: parseTargetUserIds(formData.get("targetUserIds")),
    };
    await applyEnvChange({
      flagId,
      env,
      next,
      reason,
      renderedAt: rendered ? new Date(rendered) : null,
      action: (currentEnabled) => transitionAction(env, currentEnabled, enabled),
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    backTo(flagId, message(e));
  }
  revalidatePath(`/flags/${flagId}`);
  backTo(flagId);
}

/** One click, prod off, still permission-checked and still audited. */
export async function killSwitchAction(formData: FormData) {
  const flagId = String(formData.get("flagId") ?? "");
  try {
    const state = await prisma.flagEnvState.findFirst({ where: { flagId, env: "PROD" } });
    if (!state) throw new TransitionError("Unknown environment state");
    await applyEnvChange({
      flagId,
      env: "PROD",
      next: { enabled: false, rolloutPercentage: 0, targetUserIds: state.targetUserIds },
      reason: "kill switch",
      action: () => "PROD:kill-switch",
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    backTo(flagId, message(e));
  }
  revalidatePath(`/flags/${flagId}`);
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
  revalidatePath(`/flags/${flagId}`);
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
  revalidatePath("/flags");
  redirect(`/flags/${flagId}`);
}

function isRedirect(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}
