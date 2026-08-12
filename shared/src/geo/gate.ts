import type {
  Geofence,
  GeofencePolicy,
  LocationGateReason,
  LocationGateResult,
  LocationSample,
} from '../contract/geo';
import { DEFAULT_GEOFENCE_POLICY } from '../contract/geo';
import { isValidCoordinate, signedDistanceToBoundaryM } from './polygon';

export const GATE_MESSAGES = {
  inside: 'Lokatsiya tasdiqlandi. Yangi hissa qo‘shishingiz mumkin.',
  nearBoundary:
    'Siz Xorazm chegarasiga juda yaqinsiz. So‘rovingiz qabul qilinadi, lekin moderator qo‘shimcha tekshiradi.',
  outside: 'Yangi hissa qo‘shish hozircha faqat Xorazm hududidan mumkin.',
  lowAccuracy:
    'Joylashuv aniqligi yetarli emas. Ochiq joyga chiqib yoki GPS’ni yoqib, qayta urinib ko‘ring.',
  stale: 'Joylashuv ma’lumoti eskirgan. Iltimos, qaytadan aniqlang.',
  permissionDenied:
    'Hissa qo‘shish uchun joylashuvga ruxsat kerak. Sozlamalardan ruxsatni yoqing.',
  unavailable: 'Joylashuvni aniqlab bo‘lmadi. Internet va GPS holatini tekshirib, qayta urinib ko‘ring.',
  mock: 'Qurilmada soxta joylashuv (mock location) aniqlandi. Uni o‘chirib, qayta urinib ko‘ring.',
  noGeofence: 'Hudud chegaralari sozlanmagan. Iltimos, keyinroq urinib ko‘ring.',
} as const;

function blocked(
  status: LocationGateResult['status'],
  message: string,
  reasons: LocationGateReason[],
  retryable: boolean,
): LocationGateResult {
  return { status, allowed: false, requiresReview: false, retryable, message, reasons };
}

export interface GateInput {
  /** `null` — ruxsat berilmagan yoki o'lchov olinmadi. */
  sample: LocationSample | null;
  permission: 'granted' | 'denied' | 'undetermined';
  /** Faqat `isActive` geofence'lar uzatiladi (yoki filtrlanadi). */
  geofences: readonly Geofence[];
  /** Server tomonda `Date.now()`, client tomonda ham shu. */
  nowMs?: number;
  /** Geofence o'zining `policy`si bilan keladi; bu esa global fallback. */
  fallbackPolicy?: GeofencePolicy;
}

/**
 * Lokatsiya darvozasi. Client UI'ni bloklash uchun, server esa so'rovni
 * rad etish uchun AYNAN shu funksiyani chaqiradi.
 *
 * Muhim: GPS spoofing'dan 100% himoya yo'q. Bu funksiya faqat oson
 * xatolarni to'sadi; qolgani `requiresReview` orqali moderatorga boradi.
 */
export function evaluateLocationGate(input: GateInput): LocationGateResult {
  const { sample, permission, geofences } = input;
  const nowMs = input.nowMs ?? Date.now();
  const active = geofences.filter((g) => g.isActive);

  if (permission === 'denied') {
    return blocked('permission_denied', GATE_MESSAGES.permissionDenied, ['permission_denied'], false);
  }
  if (!sample || !isValidCoordinate(sample.latitude, sample.longitude)) {
    return blocked('unavailable', GATE_MESSAGES.unavailable, ['position_unavailable'], true);
  }
  if (active.length === 0) {
    return blocked('unavailable', GATE_MESSAGES.noGeofence, ['no_active_geofence'], false);
  }

  const policy = active[0]?.policy ?? input.fallbackPolicy ?? DEFAULT_GEOFENCE_POLICY;

  const capturedMs = Date.parse(sample.capturedAt);
  const ageSec = Number.isFinite(capturedMs) ? (nowMs - capturedMs) / 1000 : Number.POSITIVE_INFINITY;
  if (!(ageSec >= -60) || ageSec > policy.maxSampleAgeSec) {
    return blocked('stale', GATE_MESSAGES.stale, ['sample_stale'], true);
  }

  if (sample.accuracy == null) {
    return blocked('low_accuracy', GATE_MESSAGES.lowAccuracy, ['accuracy_missing'], true);
  }
  if (sample.accuracy > policy.maxAccuracyM) {
    return blocked('low_accuracy', GATE_MESSAGES.lowAccuracy, ['accuracy_too_low'], true);
  }
  if (sample.isMocked && policy.blockOnMockLocation) {
    return blocked('mock_suspected', GATE_MESSAGES.mock, ['mock_location_flag'], false);
  }

  // Eng "ichkaridagi" geofence'ni tanlaymiz.
  let best: { fence: Geofence; signed: number } | null = null;
  for (const fence of active) {
    const signed = signedDistanceToBoundaryM(sample.longitude, sample.latitude, fence.area);
    if (!best || signed > best.signed) best = { fence, signed };
  }
  if (!best) {
    return blocked('unavailable', GATE_MESSAGES.noGeofence, ['no_active_geofence'], false);
  }

  const { fence, signed } = best;
  const reasons: LocationGateReason[] = [];

  if (signed < 0) {
    reasons.push('outside_polygon');
    // Aniqlik radiusi chegarani qoplasa ham ruxsat bermaymiz — faqat
    // qayta o'lchashni taklif qilamiz.
    const withinUncertainty = Math.abs(signed) <= sample.accuracy;
    if (withinUncertainty) reasons.push('within_accuracy_of_boundary');
    return {
      status: 'outside',
      allowed: false,
      requiresReview: false,
      retryable: withinUncertainty,
      matchedRegionId: fence.regionId,
      matchedGeofenceId: fence.id,
      distanceToBoundaryM: signed,
      message: withinUncertainty
        ? `${GATE_MESSAGES.outside} Chegaraga yaqin turibsiz — aniqroq joylashuv uchun qayta urinib ko‘ring.`
        : GATE_MESSAGES.outside,
      reasons,
    };
  }

  reasons.push('inside_polygon');
  const nearBoundary = signed <= Math.max(policy.boundaryReviewBufferM, sample.accuracy);
  if (nearBoundary) reasons.push('within_accuracy_of_boundary');
  if (sample.isMocked) reasons.push('mock_location_flag');

  return {
    status: nearBoundary ? 'inside_near_boundary' : 'inside',
    allowed: true,
    requiresReview: nearBoundary || !!sample.isMocked,
    retryable: false,
    matchedRegionId: fence.regionId,
    matchedGeofenceId: fence.id,
    distanceToBoundaryM: signed,
    message: nearBoundary ? GATE_MESSAGES.nearBoundary : GATE_MESSAGES.inside,
    reasons,
  };
}
