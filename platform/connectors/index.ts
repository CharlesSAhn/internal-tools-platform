import { randomUserConnector } from "./random-user";
import { disabledConnector, type Connector } from "./types";

/**
 * The connector catalog. Exactly one entry is wired to a network; the rest
 * exist to make the Power Apps gap concrete — a real platform would need an
 * adapter, credential storage and throttling behind every tile.
 */
export const connectors: Connector[] = [
  randomUserConnector,
  disabledConnector("sharepoint", "SharePoint", "Lists and document libraries."),
  disabledConnector("dataverse", "Dataverse", "Tables, relationships and business rules."),
  disabledConnector("sql-server", "SQL Server", "Direct queries against an existing database."),
  disabledConnector("outlook", "Outlook", "Mail and calendar for notification workflows."),
  disabledConnector("teams", "Teams", "Channel messages and approval cards."),
  disabledConnector("salesforce", "Salesforce", "Accounts, contacts and opportunities."),
  disabledConnector("dynamics-365", "Dynamics 365", "CRM and ERP records."),
  disabledConnector("servicenow", "ServiceNow", "Incidents, requests and CMDB records."),
];

export function getConnector(id: string): Connector | undefined {
  return connectors.find((c) => c.id === id);
}

export { ConnectorDisabledError, disabledConnector } from "./types";
export type { Connector, ConnectorRecord, ConnectorStatus } from "./types";
export {
  listRandomUsers,
  randomUserConnector,
  fixtureApplicants,
  pickRandomUser,
  RANDOM_USER_FIELDS,
  REQUEST_TIMEOUT_MS,
  RANDOM_USER_URL,
} from "./random-user";
