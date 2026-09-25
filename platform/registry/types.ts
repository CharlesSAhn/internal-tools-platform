export type PermissionDef = {
  key: string;
  description: string;
};

export type AppConfig = {
  /** stable id, also the url prefix: /<id> */
  id: string;
  name: string;
  description: string;
  /** permission required to see the app in the nav / open any of its routes */
  viewPermission: string;
  permissions: PermissionDef[];
  nav: { label: string; href: string }[];
};

export function defineApp(config: AppConfig): AppConfig {
  return config;
}
