/** Test loader: .module.css imports become an empty class map. */
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.module.css')) {
    return {
      url: 'data:text/javascript,export default new Proxy({}, { get: (t, k) => k });',
      shortCircuit: true,
    }
  }
  return next(specifier, context)
}
