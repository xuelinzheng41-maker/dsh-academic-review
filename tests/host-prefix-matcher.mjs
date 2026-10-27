/**
 * Regression test for the t7 defect: the host web server matches prefix
 * routes with `pathname !== prefix && !pathname.startsWith(prefix + '/')`
 * (dsh-host-webserver lib/index.js), so a prefix registered with a trailing
 * slash only ever matches itself and every detail path 404s on a real host.
 * The fake registrar below reproduces those semantics EXACTLY.
 */

/** Real host prefix matcher, verbatim semantics. */
function prefixMatches(prefix, pathname) {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

/** Real host route resolution over the registered routes. */
function resolveRoute(routes, pathname) {
  const exact = routes.filter(route => route.kind === 'exact' && route.path === pathname)
  if (exact.length > 0) return exact[0]
  const prefixes = routes.filter(route => route.kind === 'prefix' && prefixMatches(route.path, pathname))
  return prefixes[0] ?? null
}

export { prefixMatches, resolveRoute }
