// An Agent plus an asynchronous gateway hook uses Magpie's Bun host.
// Report only bridge readiness; requests and responses remain unchanged.
export async function onRequest(_body, context) {
  context.report?.(context.agent === 'proma' ? 'ready' : 'skipped', 0);
}
