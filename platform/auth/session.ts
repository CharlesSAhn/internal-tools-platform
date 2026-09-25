export type SessionUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
};

export const SESSION_COOKIE = "itp_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8;
