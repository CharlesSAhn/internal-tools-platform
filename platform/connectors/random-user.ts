import fixtureRecords from "./fixtures/applicants.json";
import type { Connector, ConnectorRecord } from "./types";

export const RANDOM_USER_URL = "https://randomuser.me/api/?results=8&nat=us,gb,de,fr,in";
export const REQUEST_TIMEOUT_MS = 2000;

type ApiUser = {
  login?: { uuid?: string };
  name?: { first?: string; last?: string };
  nat?: string;
};

function mapUsers(results: ApiUser[]): ConnectorRecord[] {
  return results.map((u, i) => ({
    id: u.login?.uuid ?? `random-user-${i}`,
    name: [u.name?.first, u.name?.last].filter(Boolean).join(" ") || `Applicant ${i + 1}`,
    country: u.nat ?? "US",
  }));
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
