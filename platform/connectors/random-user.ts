import fixtureRecords from "./fixtures/applicants.json";
import type { Connector, ConnectorRecord } from "./types";

/** Seeded so every pull returns the same eight people and a re-pull updates rather than inserts. */
export const RANDOM_USER_URL =
  "https://randomuser.me/api/?results=8&nat=us,gb,de,fr,in&seed=internal-tools-demo";
export const REQUEST_TIMEOUT_MS = 2000;

type ApiUser = {
  login?: { uuid?: string };
  name?: { first?: string; last?: string };
  nat?: string;
};

const NAME_MAX = 120;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Remote fields are untrusted: coerce to strings, bound the length, substitute a placeholder. */
function mapUsers(results: ApiUser[]): ConnectorRecord[] {
  return results.map((u, i) => {
    const name = [text(u.name?.first, NAME_MAX), text(u.name?.last, NAME_MAX)].filter(Boolean).join(" ");
    const country = text(u.nat, NAME_MAX).toUpperCase();
    return {
      id: text(u.login?.uuid, 64) || `random-user-${i}`,
      name: name.slice(0, NAME_MAX) || `Applicant ${i + 1}`,
      country: /^[A-Z]{2}$/.test(country) ? country : "US",
    };
  });
}

export const fixtureApplicants: ConnectorRecord[] = fixtureRecords;

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
    const body = (await response.json()) as { results?: ApiUser[] };
    if (!Array.isArray(body.results) || body.results.length === 0) return fixtureApplicants;
    return mapUsers(body.results);
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
  listRecords: listRandomUsers,
};
