/** v7.32: Centralized app URL resolver. Replaces hardcoded localhost:3000. */
export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}
export function buildAppUrl(path: string): string {
  return `${getAppUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}
