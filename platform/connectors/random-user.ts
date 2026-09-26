import fixtureUsers from "./fixtures/applicants.json";
import type { Connector, ConnectorRecord } from "./types";

/** Seeded so every pull returns the same eight people and a re-pull updates rather than inserts. */
export const RANDOM_USER_URL =
  "https://randomuser.me/api/?results=8&nat=us,gb,de,fr,in&seed=internal-tools-demo";
export const REQUEST_TIMEOUT_MS = 2000;

/**
 * The documented subset of a randomuser.me result that is kept on each record. Everything else
 * in the payload (pictures, passwords, coordinates, …) is dropped before it reaches the database.
 */
export const RANDOM_USER_FIELDS = [
  "gender",
  "name.title",
  "name.first",
  "name.last",
  "location.city",
  "location.state",
  "location.country",
  "location.postcode",
  "email",
  "login.uuid",
  "dob.date",
  "dob.age",
  "phone",
  "nat",
  "id.name",
  "id.value",
] as const;

const VALUE_MAX = 200;

/** Remote values are untrusted: only primitives survive, strings are bounded. */
function scalar(value: unknown): string | number | boolean | null {
  if (typeof value === "string") return value.slice(0, VALUE_MAX);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function readPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as object)) return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function writePath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    const next = cursor[key];
    if (!next || typeof next !== "object") cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

/** Keep only the documented paths, coerced to bounded primitives. */
export function pickRandomUser(user: unknown): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const path of RANDOM_USER_FIELDS) {
    const v = scalar(readPath(user, path));
    if (v !== null) writePath(raw, path, v);
  }
  return raw;
}

function toRecords(results: unknown[]): ConnectorRecord[] {
  return results.map((u, i) => {
    const raw = pickRandomUser(u);
    const uuid = readPath(raw, "login.uuid");
    return { id: typeof uuid === "string" && uuid.trim() ? uuid.trim().slice(0, 64) : `random-user-${i}`, raw };
  });
}

export const fixtureApplicants: ConnectorRecord[] = toRecords(fixtureUsers);

/**
 * The one connector that actually leaves the process. Any failure — timeout,
 * non-200, malformed payload — falls back to a checked-in fixture so the demo
 * and CI never depend on a third-party API being up.
 */
export async function listRandomUsers(): Promise<ConnectorRecord[]> {
  try {
    const response = await fetch(RANDOM_USER_URL, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return fixtureApplicants;
    const body = (await response.json()) as { results?: unknown[] };
    if (!Array.isArray(body.results) || body.results.length === 0) return fixtureApplicants;
    return toRecords(body.results);
  } catch {
    return fixtureApplicants;
  }
}

export const randomUserConnector: Connector = {
  id: "random-user",
  name: "Random User",
  description: "Live HTTP source of demo applicant identities (randomuser.me).",
  status: "live",
  initials: "RU",
  fields: RANDOM_USER_FIELDS,
  listRecords: listRandomUsers,
};
