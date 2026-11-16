'use client';

import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Info,
  RotateCw,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { ApiError, errorMessage } from '@/lib/api/client';
import type { Tone } from '@/lib/status';

import styles from './ui.module.css';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

export const TONE_COLOR: Record<Tone, string> = {
  good: 'var(--sp-color-status-good)',
  warning: 'var(--sp-color-status-warning)',
  critical: 'var(--sp-color-status-critical)',
  info: 'var(--sp-color-status-info)',
  neutral: '#8d99b6',
  accent: 'var(--sp-color-accent-strong)',
};
const toneStyle = (tone: Tone) => ({ '--tone': TONE_COLOR[tone] }) as CSSProperties;

// ─── Buttons ─────────────────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  icon?: LucideIcon;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      type={type}
      className={cx(styles.button, styles[variant], size === 'sm' && styles.small, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className={styles.spinner} aria-hidden />
      ) : Icon ? (
        <Icon size={15} aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  children,
  download,
}: {
  href: string;
  variant?: Variant;
  size?: 'md' | 'sm';
  icon?: LucideIcon;
  children: ReactNode;
  /** A plain download link (not client-side navigation). */
  download?: boolean;
}): ReactElement {
  const className = cx(styles.button, styles[variant], size === 'sm' && styles.small);
  const content = (
    <>
      {Icon ? <Icon size={15} aria-hidden /> : null}
      {children}
    </>
  );
  return download ? (
    <a href={href} className={className} download>
      {content}
    </a>
  ) : (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}

export function IconButton({
  label,
  icon: Icon,
  badge,
  ...rest
}: { label: string; icon: LucideIcon; badge?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={styles.iconButton} aria-label={label} title={label} {...rest}>
      <Icon size={17} aria-hidden />
      {badge ? <BadgeDot count={badge} /> : null}
    </button>
  );
}

function BadgeDot({ count }: { count: number }) {
  return (
    <span
      style={{
        position: 'absolute',
        top: 3,
        right: 3,
        minWidth: 16,
        height: 16,
        padding: '0 4px',
        borderRadius: 999,
        background: 'var(--sp-color-accent)',
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        display: 'grid',
        placeItems: 'center',
        boxShadow: '0 0 0 2px var(--sp-color-canvas)',
      }}
      aria-label={`${count} unread`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

// ─── Page structure ──────────────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}): ReactElement {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        {description ? <p className={styles.pageDescription}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.pageActions}>{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  flush = false,
  className,
  style,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** No body padding (tables). */
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  return (
    <section className={cx(styles.panel, className)} style={style}>
      {title || actions ? (
        <div className={styles.panelHeader}>
          <div>
            {title ? <h2 className={styles.panelTitle}>{title}</h2> : null}
            {description ? <p className={styles.panelDescription}>{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className={flush ? styles.panelFlush : styles.panelBody}>{children}</div>
    </section>
  );
}

export function Grid({
  columns,
  children,
  style,
}: {
  /** CSS grid-template-columns. */
  columns: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className={styles.grid} style={{ gridTemplateColumns: columns, ...style }}>
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'accent',
  loading = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  loading?: boolean;
}): ReactElement {
  return (
    <section className={cx(styles.panel, styles.stat)} style={toneStyle(tone)}>
      <div className={styles.statLabel}>
        <Icon size={15} aria-hidden />
        {label}
      </div>
      <div className={styles.statValue}>
        {loading ? <Skeleton width={64} height={28} /> : value}
      </div>
      {hint ? <div className={styles.statHint}>{hint}</div> : null}
    </section>
  );
}

// ─── Status ──────────────────────────────────────────────────────────────────────────────

export function StatusPill({
  tone,
  label,
  live = false,
}: {
  tone: Tone;
  label: string;
  live?: boolean;
}) {
  return (
    <span className={cx(styles.pill, live && styles.pillLive)} style={toneStyle(tone)}>
      <span className={styles.pillDot} aria-hidden />
      {label}
    </span>
  );
}

export function Tag({ children, icon: Icon }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <span className={styles.tag}>
      {Icon ? <Icon size={12} aria-hidden /> : null}
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  active = false,
  tone,
  label,
}: {
  value: number;
  active?: boolean;
  tone?: Tone;
  label: string;
}) {
  return (
    <div
      className={cx(styles.progress, active && styles.progressActive)}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={tone ? toneStyle(tone) : undefined}
    >
      <div
        className={styles.progressBar}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

// ─── Loading, empty and error states ─────────────────────────────────────────────────────

export function Skeleton({
  width = '100%',
  height = 14,
  style,
}: {
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={styles.skeleton}
      style={{ display: 'block', width, height, ...style }}
      aria-hidden
    />
  );
}

export function SkeletonRows({ rows = 5, height = 18 }: { rows?: number; height?: number }) {
  return (
    <div
      style={{ display: 'grid', gap: 14, padding: '6px 0' }}
      aria-busy="true"
      aria-label="Loading"
    >
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={height} width={`${92 - ((index * 13) % 30)}%`} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className={styles.state}>
      <span className={styles.stateIcon}>
        <Icon size={20} aria-hidden />
      </span>
      <h3 className={styles.stateTitle}>{title}</h3>
      {children ? <div className={styles.stateText}>{children}</div> : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}

/** A failed request: the API's message and validation details, with a retry. */
export function ErrorState({
  error,
  title = 'Could not load this',
  onRetry,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
}): ReactElement {
  const details = error instanceof ApiError ? error.details : [];
  return (
    <div className={cx(styles.state, styles.stateError)} role="alert">
      <span className={styles.stateIcon}>
        <CircleAlert size={20} aria-hidden />
      </span>
      <h3 className={styles.stateTitle}>{title}</h3>
      <div className={styles.stateText}>
        {errorMessage(error)}
        {details.length ? (
          <ul>
            {details.slice(0, 6).map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {onRetry ? (
        <div style={{ marginTop: 8 }}>
          <Button size="sm" icon={RotateCw} onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The three states of a query in one place: skeleton while loading, error with retry, or the
 * content (with an empty state when `isEmpty`).
 */
export function QueryState<T>({
  query,
  loading,
  empty,
  isEmpty,
  children,
}: {
  query: { data: T | undefined; error: unknown; isPending: boolean; refetch: () => unknown };
  loading?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}): ReactElement {
  if (query.isPending) return <>{loading ?? <SkeletonRows />}</>;
  if (query.error || query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (empty && isEmpty?.(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

export function Banner({
  tone,
  title,
  children,
}: {
  tone: 'critical' | 'warning' | 'info' | 'good';
  title: ReactNode;
  children?: ReactNode;
}) {
  const Icon = { critical: XCircle, warning: AlertTriangle, info: Info, good: CheckCircle2 }[tone];
  return (
    <div
      className={styles.banner}
      style={toneStyle(tone)}
      role={tone === 'critical' ? 'alert' : 'status'}
    >
      <Icon size={16} aria-hidden />
      <div>
        <div style={{ fontWeight: 600 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

/** An API error as a banner, with its validation details. */
export function ErrorBanner({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null;
  const details = error instanceof ApiError ? error.details : [];
  return (
    <Banner tone="critical" title={title ?? errorMessage(error)}>
      {title ? (
        <div style={{ color: 'var(--sp-color-text-secondary)' }}>{errorMessage(error)}</div>
      ) : null}
      {details.length ? (
        <ul>
          {details.slice(0, 8).map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </Banner>
  );
}

// ─── Forms ───────────────────────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  aside,
  children,
  id,
}: {
  label: string;
  hint?: ReactNode;
  aside?: ReactNode;
  children: (id: string) => ReactNode;
  id?: string;
}): ReactElement {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={fieldId}>
        {label}
        {aside !== undefined ? <span className={styles.labelAside}>{aside}</span> : null}
      </label>
      {children(fieldId)}
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={cx(styles.input, props.className)} />
);
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={cx(styles.textarea, props.className)} />
);
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={cx(styles.select, props.className)} />
);
export const Range = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input type="range" {...props} className={cx(styles.range, props.className)} />
);

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={styles.check}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; icon?: LucideIcon }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map(({ value: option, label: text, icon: Icon }) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          className={cx(styles.segment, option === value && styles.segmentActive)}
          onClick={() => onChange(option)}
        >
          {Icon ? <Icon size={14} aria-hidden /> : null}
          {text}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
}: {
  value: T;
  tabs: { value: T; label: string; count?: number | undefined }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={cx(styles.tab, tab.value === value && styles.tabActive)}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className={styles.count}>{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────────────────

/** A modal built on <dialog>: focus trapping, Escape and the backdrop come from the browser. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, wide && styles.dialogWide)}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose(); // backdrop click
      }}
    >
      {open ? (
        <>
          <div className={styles.dialogHeader}>
            <h2 className={styles.dialogTitle}>{title}</h2>
            <IconButton label="Close" icon={X} onClick={onClose} />
          </div>
          <div className={styles.dialogBody}>{children}</div>
          {footer ? <div className={styles.dialogFooter}>{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12, color: 'var(--sp-color-text-secondary)' }}>
        {children}
        <ErrorBanner error={error} />
      </div>
    </Modal>
  );
}

/** A dropdown anchored to its trigger; closes on outside click and Escape. */
export function Menu({
  trigger,
  children,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open ? <div className={styles.menu}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

// ─── Toasts ──────────────────────────────────────────────────────────────────────────────

interface Toast {
  id: number;
  tone: 'good' | 'critical' | 'info';
  title: string;
  detail?: string | undefined;
}

const ToastContext = createContext<(toast: Omit<Toast, 'id'>) => void>(() => undefined);

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items.slice(-3), { ...toast, id }]);
    setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 5_000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className={styles.toasts} aria-live="polite">
        {toasts.map((toast) => {
          const Icon = { good: CheckCircle2, critical: XCircle, info: Info }[toast.tone];
          return (
            <div key={toast.id} className={styles.toast} style={toneStyle(toast.tone)}>
              <Icon size={16} aria-hidden />
              <div>
                <div className={styles.toastTitle}>{toast.title}</div>
                {toast.detail ? <div className={styles.toastDetail}>{toast.detail}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// ─── Tables ──────────────────────────────────────────────────────────────────────────────

export const table = {
  wrap: styles.tableWrap,
  table: styles.table,
  num: styles.num,
  muted: styles.muted,
  strong: styles.strong,
  link: styles.rowLink,
};

export function DefinitionList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className={styles.definitionList}>
      {items.map(([term, value], index) => (
        <div key={index} style={{ display: 'contents' }}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
