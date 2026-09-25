import { NextResponse } from "next/server";
import type { FlagEnv } from "@prisma/client";
import { prisma } from "@platform/db";
import { ENVS, type FlagEnvName } from "@/app/flags/policy";

/**
 * Machine-facing read model: services poll this instead of talking to the DB,
 * so the internal tool is the source of truth for humans and for runtime.
 */
export async function GET(request: Request) {
  const token = process.env.FLAGS_API_TOKEN;
  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !presented || presented !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const envParam = (new URL(request.url).searchParams.get("env") ?? "prod").toUpperCase() as FlagEnvName;
  if (!ENVS.includes(envParam)) {
    return NextResponse.json({ error: `unknown env "${envParam.toLowerCase()}"` }, { status: 400 });
  }

  const states = await prisma.flagEnvState.findMany({
    where: { env: envParam as FlagEnv, flag: { archived: false } },
    include: { flag: { select: { key: true } } },
    orderBy: { flag: { key: "asc" } },
  });

  return NextResponse.json({
    env: envParam.toLowerCase(),
    generatedAt: new Date().toISOString(),
    flags: Object.fromEntries(
      states.map((s) => [
        s.flag.key,
        { enabled: s.enabled, rolloutPercentage: s.rolloutPercentage, targetUserIds: s.targetUserIds },
      ]),
    ),
  });
}
