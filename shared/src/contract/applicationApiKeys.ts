import type { IsoDateTime, PageQuery, Paginated, Uuid } from './common';

/** Tashqi integratsiyalarga berilishi mumkin bo'lgan, faqat o'qish scope'lari. */
export const APPLICATION_API_KEY_SCOPES = [
  'dictionary:read',
  'content:read',
  'diagnostics:read',
] as const;

export type ApplicationApiKeyScope = (typeof APPLICATION_API_KEY_SCOPES)[number];

export const APPLICATION_API_KEY_SCOPE_LABELS: Record<ApplicationApiKeyScope, string> = {
  'dictionary:read': 'Lug‘at va hududlarni o‘qish',
  'content:read': 'Ilova matni va havolalarini o‘qish',
  'diagnostics:read': 'Xavfsiz tizim holatini o‘qish',
};

/** To'liq secret hech qachon bu ko'rinishga kirmaydi. */
export interface ApplicationApiKeyView {
  id: Uuid;
  name: string;
  publicId: string;
  maskedHint: string;
  scopes: ApplicationApiKeyScope[];
  expiresAt?: IsoDateTime | null;
  rateLimitPerHour: number;
  isActive: boolean;
  lastUsedAt?: IsoDateTime | null;
  lastUsedIp?: string | null;
  revokedAt?: IsoDateTime | null;
  revokeReason?: string | null;
  createdBy?: Uuid | null;
  createdByName?: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ApplicationApiKeyListQuery extends PageQuery {
  status?: 'active' | 'revoked' | 'expired' | 'all';
  search?: string;
}

export type ApplicationApiKeyListResponse = Paginated<ApplicationApiKeyView>;

export interface CreateApplicationApiKeyRequest {
  name: string;
  scopes: ApplicationApiKeyScope[];
  expiresAt?: IsoDateTime | null;
  rateLimitPerHour?: number;
  changeReason: string;
}

/** `secret` faqat create/rotate javobida bir marta qaytadi. */
export interface ApplicationApiKeySecretResponse {
  key: ApplicationApiKeyView;
  secret: string;
  auditLogId: Uuid;
}

export interface RotateApplicationApiKeyRequest {
  changeReason: string;
}

export interface RevokeApplicationApiKeyRequest {
  reason: string;
}

export interface RevokeApplicationApiKeyResponse {
  key: ApplicationApiKeyView;
  auditLogId: Uuid;
}
