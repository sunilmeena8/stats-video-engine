import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100vh',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>
        <p style={{ margin: 0, color: 'var(--sp-color-accent-strong)', fontWeight: 650 }}>404</p>
        <h1 style={{ margin: '6px 0 8px', fontSize: 22 }}>This page does not exist</h1>
        <Link href="/">Back to the overview</Link>
      </div>
    </main>
  );
}
