/**
 * Version + build metadata. The version is bumped manually on each major
 * change; the build_at timestamp is captured at module-load time during the
 * Next.js static export.
 */

export const VERSION = "0.6.0";

export const BUILD_AT = new Date().toISOString();
