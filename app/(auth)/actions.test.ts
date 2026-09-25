import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/test/next-mocks")).headersModule);
vi.mock("next/navigation", async () => (await import("@/test/next-mocks")).navigationModule);
vi.mock("next/cache", async () => (await import("@/test/next-mocks")).cacheModule);

import { getCurrentUser } from "@platform/auth";
import { SESSION_COOKIE } from "@platform/auth/session";
import { captureRedirect, cookieJar, formData } from "@/test/next-mocks";
import { cleanupFixtures, makeUser, signOut } from "@/test/fixtures";
import { signInAction, signOutAction } from "./actions";

beforeEach(() => {
  signOut();
});

afterAll(async () => {
  await cleanupFixtures();
});

describe("signInAction", () => {
  it("issues a session cookie for a known user and lands on the home page", async () => {
    const user = await makeUser(["flags.app.view"], "signin");

    const redirected = await captureRedirect(() => signInAction(formData({ email: user.email })));

    expect(redirected.path).toBe("/");
    expect(cookieJar.get(SESSION_COOKIE)).toBeTruthy();
    expect(await getCurrentUser()).toMatchObject({ id: user.id, permissions: ["flags.app.view"] });
  });

  it.each([
    ["an unknown email", "nobody@test.local"],
    ["an empty email", ""],
  ])("rejects %s without creating a session", async (_label, email) => {
    const redirected = await captureRedirect(() => signInAction(formData({ email })));

    expect(redirected.path).toBe("/login");
    expect(redirected.error).toBe("Unknown demo user");
    expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("is case-sensitive on the email, matching the unique key", async () => {
    const user = await makeUser(["flags.app.view"], "case");
    const redirected = await captureRedirect(() =>
      signInAction(formData({ email: user.email.toUpperCase() })),
    );
    expect(redirected.error).toBe("Unknown demo user");
  });
});

describe("signOutAction", () => {
  it("clears the session cookie and returns to the login page", async () => {
    const user = await makeUser(["flags.app.view"], "signout");
    await captureRedirect(() => signInAction(formData({ email: user.email })));
    expect(cookieJar.get(SESSION_COOKIE)).toBeTruthy();

    const redirected = await captureRedirect(() => signOutAction());

    expect(redirected.path).toBe("/login");
    expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
    expect(await getCurrentUser()).toBeNull();
  });

  it("is safe to call without a session", async () => {
    const redirected = await captureRedirect(() => signOutAction());
    expect(redirected.path).toBe("/login");
  });
});

describe("session resolution", () => {
  it("resolves to nobody when the signed-in user has been deleted", async () => {
    const user = await makeUser(["flags.app.view"], "ghost");
    await captureRedirect(() => signInAction(formData({ email: user.email })));
    const token = cookieJar.get(SESSION_COOKIE) as string;

    await cleanupFixtures();
    cookieJar.set(SESSION_COOKIE, token);

    expect(await getCurrentUser()).toBeNull();
  });

  it("ignores a tampered session cookie", async () => {
    cookieJar.set(SESSION_COOKIE, "not.a.jwt");
    expect(await getCurrentUser()).toBeNull();
  });
});
