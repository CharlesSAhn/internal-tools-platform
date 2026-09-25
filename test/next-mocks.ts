/**
 * Stand-ins for the Next.js request-scoped modules the server actions reach
 * for. They let the real actions run under vitest against a real database:
 * cookies live in a map, `redirect()` throws a catchable error carrying its
 * target, and `revalidatePath()` records what was invalidated.
 */

const jar = new Map<string, string>();

export const cookieJar = {
  get: (name: string) => jar.get(name),
  set: (name: string, value: string) => jar.set(name, value),
  clear: () => jar.clear(),
};

export const headersModule = {
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
};

export class RedirectError extends Error {
  readonly digest: string;

  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};307;`;
  }
}

export const navigationModule = {
  redirect: (url: string): never => {
    throw new RedirectError(url);
  },
  notFound: (): never => {
    throw new Error("NEXT_NOT_FOUND");
  },
};

export const revalidated: string[] = [];

export const cacheModule = {
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
  revalidateTag: () => {},
};

export type Redirected = { path: string; params: URLSearchParams; error: string | null };

/** Runs a server action that is expected to end in a redirect and reports where to. */
export async function captureRedirect(run: () => Promise<unknown>): Promise<Redirected> {
  try {
    await run();
  } catch (e) {
    if (e instanceof RedirectError) {
      const url = new URL(e.url, "http://test.local");
      return { path: url.pathname, params: url.searchParams, error: url.searchParams.get("error") };
    }
    throw e;
  }
  throw new Error("expected the action to redirect");
}

export function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
