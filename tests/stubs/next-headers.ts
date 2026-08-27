/**
 * Test stub for `next/headers`.
 */
export type CookieEntry = { name?: string; value?: string };

export type CookieStoreStub = {
  get: (name: string) => CookieEntry | undefined;
  set?: (name: string, value: string) => void;
  delete?: (name: string) => void;
};

type CookieGetter = () => Promise<CookieStoreStub> | CookieStoreStub;

let cookieGetter: CookieGetter = () => ({
  get: () => undefined,
  set: () => {},
  delete: () => {},
});

export function __setCookieStore(getter: CookieGetter) {
  cookieGetter = getter;
}

export async function cookies(): Promise<CookieStoreStub> {
  return typeof cookieGetter === "function" ? await cookieGetter() : cookieGetter;
}

export async function headers(): Promise<Headers> {
  return new Headers();
}
