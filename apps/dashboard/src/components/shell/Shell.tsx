'use client';

import type { User } from '@statsopedia/shared-types';
import {
  Bell,
  CheckCircle2,
  Clapperboard,
  Database,
  Film,
  Hash,
  Images,
  LayoutDashboard,
  ListVideo,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersHorizontal,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { IconButton, Menu, TONE_COLOR } from '@/components/ui';
import { useJobs } from '@/lib/api/queries';
import { formatRelative } from '@/lib/format';
import { LiveProvider, useLive } from '@/lib/live';
import { signOut } from '@/lib/session-client';
import { useSidebarCollapsed } from '@/lib/sidebar';
import { isActive } from '@/lib/status';

import styles from './shell.module.css';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Workspace',
    items: [
      { href: '/', label: 'Overview', icon: LayoutDashboard },
      { href: '/topics', label: 'Topics', icon: Hash },
      { href: '/datasets', label: 'Datasets', icon: Database },
    ],
  },
  {
    group: 'Production',
    items: [
      { href: '/projects', label: 'Video Projects', icon: Clapperboard },
      { href: '/studio', label: 'Video Studio', icon: SlidersHorizontal },
      { href: '/renders', label: 'Render Queue', icon: ListVideo },
    ],
  },
  {
    group: 'Library',
    items: [
      { href: '/media', label: 'Media Library', icon: Images },
      { href: '/videos', label: 'Generated Videos', icon: Film },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const SECTION_LABEL: Record<string, string> = Object.fromEntries(
  NAV.flatMap(({ items }) => items.map((item) => [item.href.slice(1), item.label])),
);

// ─── Breadcrumbs ─────────────────────────────────────────────────────────────────────────

const Crumbs = createContext<(path: string, label: string | undefined) => void>(() => undefined);

/** Names a dynamic path segment in the breadcrumbs (e.g. a project id → its name). */
export function useBreadcrumb(path: string, label: string | undefined) {
  const set = useContext(Crumbs);
  useEffect(() => {
    set(path, label);
  }, [set, path, label]);
}

function Breadcrumbs({ labels }: { labels: Record<string, string> }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const trail = [
    { href: '/', label: 'Overview' },
    ...segments.map((segment, index) => {
      const href = `/${segments.slice(0, index + 1).join('/')}`;
      return {
        href,
        label:
          labels[href] ??
          (index === 0 ? (SECTION_LABEL[segment] ?? segment) : segment === 'new' ? 'New' : '…'),
      };
    }),
  ];
  return (
    <nav aria-label="Breadcrumb" style={{ minWidth: 0 }}>
      <ol className={styles.crumbs}>
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={crumb.href}>
              {index > 0 ? <span aria-hidden>/</span> : null}
              {last ? (
                <span className={styles.crumbCurrent} aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href}>{crumb.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Shell ───────────────────────────────────────────────────────────────────────────────

export function Shell({ user, children }: { user: User; children: ReactNode }) {
  const [collapsed, toggle] = useSidebarCollapsed();
  const [labels, setLabels] = useState<Record<string, string>>({});
  const setLabel = useMemo(
    () => (path: string, label: string | undefined) =>
      setLabels((current) => {
        if (label === undefined || current[path] === label) return current;
        return { ...current, [path]: label };
      }),
    [],
  );

  return (
    <LiveProvider>
      <Crumbs.Provider value={setLabel}>
        <div className={`${styles.shell} ${collapsed ? styles.collapsed : ''}`}>
          <Sidebar collapsed={collapsed} onToggle={toggle} />
          <div className={styles.main}>
            <header className={styles.topbar}>
              <Breadcrumbs labels={labels} />
              <div className={styles.topActions}>
                <Notifications />
                <UserMenu user={user} />
              </div>
            </header>
            <main className={styles.content}>{children}</main>
          </div>
        </div>
      </Crumbs.Provider>
    </LiveProvider>
  );
}

export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id="sp-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8ec0ff" />
          <stop offset="1" stopColor="#2f7bf2" />
        </linearGradient>
      </defs>
      <rect x="3" y="4" width="18" height="4" rx="1.5" fill="url(#sp-mark)" />
      <rect x="3" y="10" width="13" height="4" rx="1.5" fill="url(#sp-mark)" opacity="0.8" />
      <rect x="3" y="16" width="8" height="4" rx="1.5" fill="url(#sp-mark)" opacity="0.6" />
    </svg>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const { connected } = useLive();
  const jobs = useJobs();
  const active = jobs.data?.filter(isActive).length ?? 0;
  const isCurrent = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className={styles.sidebar} aria-label="Main navigation">
      <Link href="/" className={styles.brand} aria-label="Statsopedia overview">
        <span className={styles.mark}>
          <BrandMark />
        </span>
        <span className={styles.wordmark}>
          <strong>Statsopedia</strong>
          <span>The World, By The Numbers</span>
        </span>
      </Link>
      <nav>
        {NAV.map(({ group, items }) => (
          <div key={group}>
            <div className={styles.navGroup}>{group}</div>
            <div className={styles.nav}>
              {items.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`${styles.navLink} ${isCurrent(href) ? styles.navActive : ''}`}
                  aria-current={isCurrent(href) ? 'page' : undefined}
                  title={collapsed ? label : undefined}
                >
                  <Icon size={17} aria-hidden />
                  <span className={styles.navLabel}>{label}</span>
                  {href === '/renders' && active > 0 ? (
                    <span className={styles.navBadge} aria-label={`${active} active`}>
                      {active}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className={styles.sidebarFooter}>
        <div className={styles.connection} title={connected ? 'Live updates on' : 'Connecting…'}>
          <span className={`${styles.connectionDot} ${connected ? styles.connectionLive : ''}`} />
          <span className={styles.connectionText}>
            {connected ? 'Live updates' : 'Connecting…'}
          </span>
        </div>
        <button
          type="button"
          className={styles.collapseButton}
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <PanelLeftOpen size={17} aria-hidden />
          ) : (
            <PanelLeftClose size={17} aria-hidden />
          )}
          <span className={styles.navLabel}>Collapse sidebar</span>
        </button>
      </div>
    </aside>
  );
}

function Notifications() {
  const { notifications, unread, markAllRead } = useLive();
  return (
    <Menu
      trigger={({ toggle }) => (
        <IconButton
          label="Notifications"
          icon={Bell}
          badge={unread}
          onClick={() => {
            toggle();
          }}
        />
      )}
    >
      {(close) => (
        <div className={styles.notifications}>
          <div className={styles.notificationsHead}>
            Render activity
            {unread ? (
              <button
                type="button"
                className={styles.menuItem}
                style={{ width: 'auto', height: 26 }}
                onClick={markAllRead}
              >
                Mark all read
              </button>
            ) : null}
          </div>
          {notifications.length === 0 ? (
            <p
              style={{
                margin: 0,
                padding: '18px 10px',
                color: 'var(--sp-color-text-muted)',
                fontSize: 13,
              }}
            >
              Finished and failed renders appear here as they happen.
            </p>
          ) : (
            notifications.map((item) => {
              const Icon = { good: CheckCircle2, critical: XCircle, warning: TriangleAlert }[
                item.tone
              ];
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`${styles.notification} ${item.read ? '' : styles.unread}`}
                  onClick={() => {
                    markAllRead();
                    close();
                  }}
                >
                  <Icon size={16} color={TONE_COLOR[item.tone]} aria-hidden />
                  <span style={{ minWidth: 0 }}>
                    <div className={styles.notificationTitle}>{item.title}</div>
                    <div className={styles.notificationDetail}>
                      {item.detail} · {formatRelative(item.at)}
                    </div>
                  </span>
                </Link>
              );
            })
          )}
        </div>
      )}
    </Menu>
  );
}

const initials = (user: User) =>
  (user.name || user.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

function UserMenu({ user }: { user: User }) {
  const [signingOut, setSigningOut] = useState(false);
  return (
    <Menu
      trigger={({ toggle, open }) => (
        <button
          type="button"
          className={styles.userButton}
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <span className={styles.avatar} aria-hidden>
            {initials(user)}
          </span>
          <span className={styles.userName}>{user.name || user.email}</span>
        </button>
      )}
    >
      {(close) => (
        <div role="menu">
          <div className={styles.menuHeader}>
            <strong>{user.name || user.email}</strong>
            <span>
              {user.email} · {user.role}
            </span>
          </div>
          <Link href="/settings" className={styles.menuItem} role="menuitem" onClick={close}>
            <Settings size={15} aria-hidden /> Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void signOut();
            }}
          >
            <LogOut size={15} aria-hidden /> {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </Menu>
  );
}
