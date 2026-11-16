/**
 * True unless the request comes from another site. Browsers send `Origin` on every cross-site
 * request that can change data; a same-origin page sends its own host (or nothing).
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get('host') ?? new URL(request.url).host);
  } catch {
    return false;
  }
}
