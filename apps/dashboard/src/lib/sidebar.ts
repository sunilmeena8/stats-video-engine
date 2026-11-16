'use client';

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'statsopedia.sidebar.collapsed';
const NARROW = '(max-width: 1099px)';
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null; // storage unavailable: follow the screen width
  }
}

function subscribeStored(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function subscribeWidth(listener: () => void) {
  const query = window.matchMedia(NARROW);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/**
 * Whether the sidebar is collapsed: the user's choice when they made one (kept in this
 * browser), otherwise collapsed on narrow (tablet) screens. Server render: expanded.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const stored = useSyncExternalStore(subscribeStored, readStored, () => null);
  const narrow = useSyncExternalStore(
    subscribeWidth,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
  const collapsed = stored === null ? narrow : stored === '1';
  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(KEY, collapsed ? '0' : '1');
    } catch {
      // Not persisted.
    }
    for (const listener of listeners) listener();
  }, [collapsed]);
  return [collapsed, toggle];
}
