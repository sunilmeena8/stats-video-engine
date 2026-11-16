'use client';

import { LogIn } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Banner, Button, ErrorBanner, Field, Input } from '@/components/ui';
import { endpoints } from '@/lib/api/endpoints';

/** Only same-site paths, so `?next=` cannot send people elsewhere after sign-in. */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      style={{ display: 'grid', gap: 16 }}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        endpoints
          .login(email, password)
          .then(() => {
            // Full load, so the dashboard starts with the new session's data only.
            window.location.assign(safeNext(params.get('next')));
          })
          .catch((caught: unknown) => {
            setError(caught);
            setBusy(false);
          });
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 20, letterSpacing: '-0.01em' }}>Sign in</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--sp-color-text-secondary)' }}>
          Use your Statsopedia studio account.
        </p>
      </div>
      {params.get('expired') ? (
        <Banner tone="info" title="Your session ended. Sign in again to continue." />
      ) : null}
      <ErrorBanner error={error} />
      <Field label="Email">
        {(id) => (
          <Input
            id={id}
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </Field>
      <Field label="Password">
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" icon={LogIn} loading={busy}>
        Sign in
      </Button>
    </form>
  );
}
