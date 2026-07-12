const DEFAULT_ROUTE = "/";

const SUPPORTED_ROUTES = new Set([
  DEFAULT_ROUTE,
  "/index.html",
  "/history",
  "/stats",
  "/agents",
  "/review",
  "/terminal",
  "/browser",
  "/connectors/slack",
  "/config",
  "/theme",
]);

export function normalizeQivrynWebviewRoute(
  route: string | undefined,
): string | undefined {
  if (!route) return undefined;
  const pathname = route.split(/[?#]/, 1)[0];
  return SUPPORTED_ROUTES.has(pathname) ? route : DEFAULT_ROUTE;
}
