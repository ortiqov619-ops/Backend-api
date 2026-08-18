/**
 * `@xorazm/shared` — foydalanuvchi ilovasi, admin mobil ilovasi va
 * (kelajakdagi) server o'rtasidagi yagona shartnoma.
 *
 * Bu paketda platformaga bog'liq kod yo'q: faqat turlar, sof funksiyalar
 * va `fetch` ustidagi yupqa HTTP mijozi.
 */

export * from './contract/common';
export * from './contract/auth';
export * from './contract/profile';
export * from './contract/geo';
export * from './contract/validation';
export * from './contract/words';
export * from './contract/audio';
export * from './contract/transcription';
export * from './contract/contributions';
export * from './contract/admin';
export * from './contract/telemetry';
export * from './contract/community';
export * from './contract/notifications';
export * from './contract/appUpdates';
export * from './updates/policy';

export * from './geo/polygon';
export * from './geo/gate';
export * from './geo/xorazm';

export * from './validation/phonetics';
export * from './validation/lexicon';
export * from './validation/text';
export * from './validation/audio';

export * from './client/http';
export * from './client/api';

export const SHARED_CONTRACT_VERSION = '3.0.0';
