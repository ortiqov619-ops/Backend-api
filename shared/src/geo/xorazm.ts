import type { GeoJsonPolygon, Geofence } from '../contract/geo';
import { DEFAULT_GEOFENCE_POLICY } from '../contract/geo';

/**
 * Xorazm viloyatining TAXMINIY chegarasi.
 *
 * Bu qiymat rasmiy kadastr chegarasi EMAS — u faqat boshlang'ich (seed)
 * ma'lumot. Aniq chegara admin panelning "Hududlar" bo'limidan
 * `PUT /admin/geofences/:id` orqali yuklanadi va shundan keyin haqiqiy
 * manba DB'dagi qiymat bo'ladi.
 *
 * Koordinatalar GeoJSON tartibida: [longitude, latitude].
 */
export const XORAZM_APPROX_POLYGON: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [60.05, 41.95],
      [60.32, 42.18],
      [60.62, 42.3],
      [61.05, 42.11],
      [61.28, 41.86],
      [61.52, 41.6],
      [61.62, 41.36],
      [61.5, 41.11],
      [61.18, 40.9],
      [60.83, 40.76],
      [60.5, 40.83],
      [60.22, 41.06],
      [59.98, 41.36],
      [59.9, 41.66],
      [60.05, 41.95],
    ],
  ],
};

export const XORAZM_REGION_SEED_ID = '00000000-0000-4000-8000-000000000001';
export const XORAZM_GEOFENCE_SEED_ID = '00000000-0000-4000-8000-000000000101';

/** Migratsiya va mock ma'lumotlar uchun boshlang'ich geofence. */
export const XORAZM_DEFAULT_GEOFENCE: Geofence = {
  id: XORAZM_GEOFENCE_SEED_ID,
  regionId: XORAZM_REGION_SEED_ID,
  name: 'Xorazm viloyati (taxminiy)',
  area: XORAZM_APPROX_POLYGON,
  policy: DEFAULT_GEOFENCE_POLICY,
  isActive: true,
  version: 1,
  note: 'Seed qiymat. Aniq chegara admin panel orqali yangilanishi kerak.',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** Xorazm tumanlari — hudud metama'lumotini tekshirish uchun. */
export const XORAZM_DISTRICTS = [
  'Urganch',
  'Xiva',
  'Bog‘ot',
  'Gurlan',
  'Qo‘shko‘pir',
  'Shovot',
  'Xonqa',
  'Hazorasp',
  'Yangiariq',
  'Yangibozor',
  'Tuproqqal’a',
] as const;

export type XorazmDistrict = (typeof XORAZM_DISTRICTS)[number];
