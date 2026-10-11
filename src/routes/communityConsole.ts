import type { UserRole } from '../types';
import { isCommunityConsolePath } from '../../config/communityConsolePaths';
export { isCommunityConsolePath, communityConsoleTarget } from '../../config/communityConsolePaths';

export function usesCommunityConsole(role: UserRole | undefined, path: string): boolean {
  return (role === 'rec_manager' || role === 'prosumer') && isCommunityConsolePath(path);
}

