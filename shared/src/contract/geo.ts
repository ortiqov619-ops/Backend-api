import type { Auditable, IsoDateTime, Uuid } from './common';

/** [longitude, latitude] — GeoJSON tartibi. */
export type GeoPosition = [number, number];

/** Tashqi halqa + (ixtiyoriy) teshiklar. GeoJSON Polygon `coordinates`. */
export type PolygonRings = GeoPosition[][];

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: PolygonRings;
}

export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: PolygonRings[];
}

export type GeoJsonArea = GeoJsonPolygon | GeoJsonMultiPolygon;

/** Qurilmadan olingan xom lokatsiya o'lchovi. */
export interface LocationSample {
  latitude: number;
  longitude: number;
  /** Gorizontal aniqlik, metr. Qurilma bermasa `null`. */
  accuracy: number | null;
  /** O'lchov vaqti (qurilma soati). */
  capturedAt: IsoDateTime;
  /** Android/iOS mock-location bayrog'i, agar platforma bersa. */
  isMocked?: boolean | null;
  provider?: 'gps' | 'network' | 'fused' | 'unknown';
  altitude?: number | null;
  speed?: number | null;
}

/**
 * Lokatsiya darvozasining natijasi. Client ham, server ham AYNAN shu
 * funksiyani (`evaluateLocationGate`) chaqiradi — qaror bir xil bo'lishi uchun.
 */
export type LocationGateStatus =
  | 'inside'
  | 'inside_near_boundary'
  | 'outside'
  | 'low_accuracy'
  | 'stale'
  | 'permission_denied'
  | 'unavailable'
  | 'mock_suspected';

/** DB'da `contribution_requests.submission_location_status` sifatida saqlanadi. */
export type SubmissionLocationStatus = LocationGateStatus | 'not_provided' | 'server_mismatch';

export interface LocationGateResult {
  status: LocationGateStatus;
  /** Yangi hissa yuborish mumkinmi. */
  allowed: boolean;
  /** Yuborilsa ham moderatorga majburiy tushsinmi. */
  requiresReview: boolean;
  /** Qayta o'lchash foyda beradimi (UI "Qayta urinish" tugmasi uchun). */
  retryable: boolean;
  /** Mos kelgan hudud (geofence) id'si. */
  matchedRegionId?: Uuid;
  matchedGeofenceId?: Uuid;
  /** Chegaragacha masofa, metr. Manfiy = tashqarida. */
  distanceToBoundaryM?: number;
  /** Foydalanuvchiga ko'rsatiladigan o'zbekcha xabar. */
  message: string;
  /** Audit uchun mashina o'qiydigan sabablar. */
  reasons: LocationGateReason[];
}

export type LocationGateReason =
  | 'permission_denied'
  | 'position_unavailable'
  | 'accuracy_missing'
  | 'accuracy_too_low'
  | 'sample_stale'
  | 'mock_location_flag'
  | 'inside_polygon'
  | 'outside_polygon'
  | 'within_accuracy_of_boundary'
  | 'no_active_geofence';

export interface GeofencePolicy {
  /** Shundan yomon aniqlikda yuborishga ruxsat yo'q (metr). */
  maxAccuracyM: number;
  /** O'lchov shu vaqtdan eski bo'lsa qayta o'lchanadi (sekund). */
  maxSampleAgeSec: number;
  /**
   * Chegaraga shu masofadan yaqin bo'lsa — ichkarida ham bo'lsa —
   * so'rov moderatsiyaga bayroqlanadi (metr).
   */
  boundaryReviewBufferM: number;
  /** Mock-location bayrog'i ko'tarilsa bloklansinmi yoki faqat bayroqlansinmi. */
  blockOnMockLocation: boolean;
}

export const DEFAULT_GEOFENCE_POLICY: GeofencePolicy = {
  maxAccuracyM: 100,
  maxSampleAgeSec: 120,
  boundaryReviewBufferM: 1000,
  blockOnMockLocation: true,
};

/**
 * Hudud daraja ierarxiyasi:
 * `republic` — respublika/davlat (O‘zbekiston, Turkmaniston, Qoraqalpog‘iston, Afg‘oniston);
 * `region` — viloyat;
 * `district` — shahar/tuman;
 * `village` — qishloq / oba / ovul / jamoa xo‘jaligi;
 * `neighborhood` — mahalla.
 *
 * Urug‘/laqab va lahja alohida daraja emas: ular so‘zning o‘z maydonlari
 * (`Word.clan`, `Word.dialectId`), chunki bitta qishloqda bir nechta
 * urug‘ va lahja yonma-yon yashaydi.
 */
export type RegionLevel = 'republic' | 'region' | 'district' | 'village' | 'neighborhood';

export const REGION_LEVELS: readonly RegionLevel[] = ['republic', 'region', 'district', 'village', 'neighborhood'] as const;

export const REGION_LEVEL_LABELS: Record<RegionLevel, string> = {
  republic: 'Respublika / davlat',
  region: 'Viloyat',
  district: 'Shahar / tuman',
  village: 'Qishloq / oba / ovul / jamoa xo‘jaligi',
  neighborhood: 'Mahalla',
};

export interface Region extends Auditable {
  id: Uuid;
  /** `xorazm`, `xiva`, `urganch` ... */
  code: string;
  nameUz: string;
  nameOz?: string | null;
  /**
   * Hududning eski (tarixiy) nomi — «jamoa xo‘jaligi» davridagi nom ham
   * shu yerda saqlanadi. Faqat ma’lumot: qidiruv va FK bunga tayanmaydi.
   */
  formerName?: string | null;
  parentId?: Uuid | null;
  level: RegionLevel;
  isContributionAllowed: boolean;
  /** Statistika uchun; API to'ldiradi. */
  wordCount?: number;
  audioCount?: number;
  dominantDialectId?: Uuid | null;
}

export interface Geofence extends Auditable {
  id: Uuid;
  regionId: Uuid;
  name: string;
  area: GeoJsonArea;
  policy: GeofencePolicy;
  isActive: boolean;
  /** Har tahrirda oshadi; validation_results shu versiyani saqlaydi. */
  version: number;
  note?: string | null;
}

export interface Dialect extends Auditable {
  id: Uuid;
  code: string;
  nameUz: string;
  description?: string | null;
  /** Shu lahjaga xos belgi so'zlar — matn filtri shulardan foydalanadi. */
  markerWords: string[];
  regionIds: Uuid[];
  isActive: boolean;
}

/** GET /regions */
export interface RegionListQuery {
  parentId?: Uuid;
  level?: RegionLevel;
  includeGeofences?: boolean;
}

export interface RegionListResponse {
  items: Region[];
  geofences?: Geofence[];
  dialects?: Dialect[];
}

/** PUT /admin/geofences/:id */
export interface UpdateGeofenceRequest {
  name?: string;
  area?: GeoJsonArea;
  policy?: Partial<GeofencePolicy>;
  isActive?: boolean;
  note?: string;
  /** Optimistik qulf: mavjud `version` yuboriladi, mos kelmasa 409. */
  expectedVersion: number;
  /** Chegarani kim, nima uchun o'zgartirgani — audit uchun majburiy. */
  changeReason: string;
}

export interface UpdateGeofenceResponse {
  geofence: Geofence;
}

/** Admin hudud katalogini kengaytiradi. Yangi hudud xavfsizlik uchun yopiq yaratiladi. */
export interface CreateRegionRequest {
  code: string;
  nameUz: string;
  /** Berilmasa `region` deb qabul qilinadi (avvalgi xulq). */
  level?: RegionLevel;
  /** `republic` uchun bo‘sh; qolgan darajalarda majburiy. */
  parentId?: Uuid | null;
  formerName?: string | null;
  changeReason: string;
}

export interface UpdateRegionRequest {
  isContributionAllowed: boolean;
  changeReason: string;
}

export interface RegionMutationResponse { region: Region; }
