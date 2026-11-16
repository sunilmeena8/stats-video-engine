import { endpoints } from './api/endpoints';

/**
 * Ends the session and reloads into sign-in. A full page load (not client navigation) drops
 * every cached query of the signed-out user.
 */
export async function signOut(): Promise<void> {
  await endpoints.logout().catch(() => undefined);
  window.location.replace('/login');
}
