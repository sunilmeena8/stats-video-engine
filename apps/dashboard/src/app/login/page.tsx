import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoginForm } from './LoginForm';
import styles from './login.module.css';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <section className={styles.story} aria-hidden>
        <div className={styles.bars}>
          {[92, 78, 71, 63, 55, 48, 41].map((width, index) => (
            <div
              key={width}
              className={styles.bar}
              style={{ width: `${width}%`, animationDelay: `${index * 90}ms` }}
            />
          ))}
        </div>
        <p className={styles.quote}>
          Versioned datasets in. Ranking videos out — long-form and Shorts, rendered the same way
          every time.
        </p>
      </section>
      <section className={styles.panel}>
        <div className={styles.brand}>
          <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden>
            <defs>
              <linearGradient id="login-mark" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#8ec0ff" />
                <stop offset="1" stopColor="#2f7bf2" />
              </linearGradient>
            </defs>
            <rect x="3" y="4" width="18" height="4" rx="1.5" fill="url(#login-mark)" />
            <rect
              x="3"
              y="10"
              width="13"
              height="4"
              rx="1.5"
              fill="url(#login-mark)"
              opacity="0.8"
            />
            <rect
              x="3"
              y="16"
              width="8"
              height="4"
              rx="1.5"
              fill="url(#login-mark)"
              opacity="0.6"
            />
          </svg>
          <div>
            <h1>Statsopedia</h1>
            <p>The World, By The Numbers</p>
          </div>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
