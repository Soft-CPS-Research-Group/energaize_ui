/** Community areas are routes of the same React app as Jobs/KPI/predictor. */
export function isCommunityConsolePath(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/$/, '') || '/';
  return pathname === '/communities' || pathname === '/app/community' || pathname.startsWith('/app/community/')
    || pathname === '/app/prosumer' || pathname.startsWith('/app/prosumer/');
}

export function communityConsoleTarget(path: string): string {
  return path.split(/[?#]/, 1)[0].replace(/\/$/, '') === '/communities' ? '/communities' : '/app/community/dashboard';
}
