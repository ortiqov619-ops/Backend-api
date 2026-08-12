import type { IsoDateTime, Uuid } from './common';

/** Faqat rozilik bergan foydalanuvchi ilovani ochganda yuboriladigan anonim hodisa. */
export interface AppOpenEvent {
  installationId: string;
  appVersion: string;
  locationConsent: boolean;
  /** Aniq koordinata emas — owner paneli uchun umumlashtirilgan kesim. */
  classification: 'xorazm' | 'outside' | 'unknown';
  regionId?: Uuid;
  openedAt: IsoDateTime;
}

export interface AppOpenSummary {
  totalOpens: number;
  uniqueInstallations: number;
  xorazmOpens: number;
  outsideOpens: number;
  unknownOpens: number;
}
