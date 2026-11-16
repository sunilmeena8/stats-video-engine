const PREFIX = 'storage:';

function walk(value: unknown, visit: (text: string) => string): unknown {
  if (typeof value === 'string') return visit(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, visit));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, visit)]));
  }
  return value;
}

/** Every `storage:assets/…` reference in the props (music, logos, images), as storage keys. */
export function collectStorageReferences(props: unknown): string[] {
  const keys = new Set<string>();
  walk(props, (text) => {
    if (text.startsWith(`${PREFIX}assets/`)) keys.add(text.slice(PREFIX.length));
    return text;
  });
  return [...keys];
}

/**
 * Replaces `storage:assets/<path>` strings with URLs on the worker's local asset server, so
 * Chrome can stream uploaded music and logos. Other values are untouched.
 */
export function resolveStorageReferences(value: unknown, assetBaseUrl: string): unknown {
  return walk(value, (text) =>
    text.startsWith(`${PREFIX}assets/`) ? `${assetBaseUrl}/${text.slice(PREFIX.length)}` : text,
  );
}
