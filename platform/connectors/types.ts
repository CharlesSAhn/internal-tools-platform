/**
 * A connector hands back the source system's record as-is (or a documented subset of it) plus a
 * stable identity. Deciding which raw fields land in which KycCase column is the admin's job, via
 * the per-connector schema mapping — the adapter does not flatten on the source's behalf.
 */
export type ConnectorRecord = {
  id: string;
  raw: Record<string, unknown>;
};

export type ConnectorStatus = "live" | "disabled";

export type Connector = {
  id: string;
  name: string;
  description: string;
  status: ConnectorStatus;
  /** Two-letter badge shown instead of a vendor logo. */
  initials: string;
  /** Dot-paths into `raw` that the schema editor offers as mapping sources. */
  fields: readonly string[];
  listRecords(): Promise<ConnectorRecord[]>;
};

export class ConnectorDisabledError extends Error {
  constructor(readonly connectorId: string) {
    super("Not wired in this prototype");
    this.name = "ConnectorDisabledError";
  }
}

function initialsOf(name: string): string {
  const words = name.split(/[\s.]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

/**
 * A catalog placeholder. It carries no credentials and no transport: calling it
 * throws rather than silently returning an empty list, so a UI that forgets to
 * check `status` fails loudly.
 */
export function disabledConnector(id: string, name: string, description: string): Connector {
  return {
    id,
    name,
    description,
    status: "disabled",
    initials: initialsOf(name),
    fields: [],
    listRecords() {
      return Promise.reject(new ConnectorDisabledError(id));
    },
  };
}
