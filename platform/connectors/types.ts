/** The only record shape a connector returns in this prototype. */
export type ConnectorRecord = {
  id: string;
  name: string;
  country: string;
};

export type ConnectorStatus = "live" | "disabled";

export type Connector = {
  id: string;
  name: string;
  description: string;
  status: ConnectorStatus;
  /** Two-letter badge shown instead of a vendor logo. */
  initials: string;
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
    listRecords() {
      return Promise.reject(new ConnectorDisabledError(id));
    },
  };
}
