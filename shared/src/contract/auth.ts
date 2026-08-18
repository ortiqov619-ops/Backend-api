import type { IsoDateTime, Uuid } from './common';

/** Panelga kira oladigan rollar. Oddiy foydalanuvchi roli `user`. */
export type AdminRole = 'admin' | 'moderator' | 'editor';
export type UserRole = AdminRole | 'user';

export const ADMIN_ROLES: readonly AdminRole[] = ['admin', 'moderator', 'editor'] as const;

/**
 * Ruxsatlar. Server ham, mobil admin ham shu bitta ro'yxatdan foydalanadi,
 * shuning uchun UI va API bir xil qaror qabul qiladi.
 */
export type Permission =
  | 'dashboard:read'
  | 'words:read'
  | 'words:write'
  | 'words:archive'
  | 'requests:read'
  | 'requests:moderate'
  | 'audio:read'
  | 'audio:moderate'
  | 'regions:read'
  | 'regions:write'
  | 'geofences:write'
  | 'dialects:write'
  | 'audit:read'
  | 'integrations:read'
  | 'integrations:write'
  | 'users:manage'
  | 'releases:read'
  | 'releases:write';

export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  admin: [
    'dashboard:read',
    'words:read',
    'words:write',
    'words:archive',
    'requests:read',
    'requests:moderate',
    'audio:read',
    'audio:moderate',
    'regions:read',
    'regions:write',
    'geofences:write',
    'dialects:write',
    'audit:read',
    'integrations:read',
    'integrations:write',
    'users:manage',
    'releases:read',
    'releases:write',
  ],
  moderator: [
    'dashboard:read',
    'words:read',
    'requests:read',
    'requests:moderate',
    'audio:read',
    'audio:moderate',
    'regions:read',
    'audit:read',
    'releases:read',
  ],
  editor: ['dashboard:read', 'words:read', 'words:write', 'requests:read', 'regions:read', 'releases:read'],
};

export function permissionsForRoles(roles: readonly AdminRole[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) set.add(permission);
  }
  return [...set];
}

export function can(session: Pick<AdminSession, 'permissions'> | null, permission: Permission): boolean {
  return !!session && session.permissions.includes(permission);
}

export interface AdminUser {
  id: Uuid;
  fullName: string;
  email: string;
  phone?: string | null;
  roles: AdminRole[];
  /** Moderator faqat shu hududlar bo'yicha navbatni ko'radi; bo'sh = barchasi. */
  assignedRegionIds: Uuid[];
  isActive: boolean;
  lastLoginAt?: IsoDateTime | null;
}

export interface AdminSession {
  user: AdminUser;
  permissions: Permission[];
  accessToken: string;
  /** Access token muddati. Refresh faqat httpOnly cookie/`refreshToken` bilan. */
  accessTokenExpiresAt: IsoDateTime;
  refreshToken: string;
}

/** POST /auth/admin/login */
export interface AdminLoginRequest {
  email: string;
  password: string;
  /** Ikki bosqichli tasdiq yoqilgan hisoblar uchun. */
  otpCode?: string;
  device: {
    platform: 'ios' | 'android';
    /** Qurilmaning barqaror, anonim identifikatori (installation id). */
    installationId: string;
    appVersion: string;
  };
}

export type AdminLoginResponse =
  | { status: 'ok'; session: AdminSession }
  | { status: 'otp_required'; challengeId: string };

/** POST /auth/admin/refresh */
export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  accessTokenExpiresAt: IsoDateTime;
  refreshToken: string;
}
