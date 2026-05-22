/** Single source of truth for prefixing internal links with the GitHub
 *  Pages base path. Next.js's `<Link>` component prefixes basePath
 *  automatically, but the codebase uses raw `<a>` tags throughout — those
 *  do NOT get auto-prefixed. Wrap every internal href with `withBase`.
 *
 *  In dev (no GH_PAGES_BASE), BASE_PATH is "" and withBase is a no-op.
 *  In prod (GH Pages), BASE_PATH is "/applied_finance" and every internal
 *  link points to the correct subpath. */
export const BASE_PATH: string = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBase(path: string): string {
  if (!path.startsWith("/")) return path;
  return `${BASE_PATH}${path}`;
}
