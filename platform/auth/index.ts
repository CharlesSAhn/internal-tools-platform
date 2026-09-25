import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@platform/db";
import { permissionsForUser } from "@platform/rbac";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionUser } from "./session";

/**
 * Demo authentication.
 *
 * The prototype signs its own short-lived session cookie and trusts a seeded
 * user directory, so the demo runs with no external IdP. Everything above this
 * module only ever sees `getCurrentUser()`, so swapping in Auth.js + OIDC
 * (Okta/Entra) means reimplementing `signIn`/`getCurrentUser` and nothing else.
 */
const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me");

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let userId: string;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub) return null;
    userId = payload.sub;
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, roles: { select: { role: { select: { key: true } } } } },
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles.map((r) => r.role.key),
    permissions: await permissionsForUser(user.id),
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Route/page guard: 403 page instead of a hidden button as the access control story. */
export async function requirePermission(permission: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.permissions.includes(permission)) redirect(`/forbidden?p=${encodeURIComponent(permission)}`);
  return user;
}

export type { SessionUser };
