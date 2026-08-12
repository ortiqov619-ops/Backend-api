/**
 * Mock ma'lumotlar — admin panel ekranlarini backendsiz ishlatish uchun.
 * Faqat `__DEV__`/demo rejimida ishlatiladi; ishlab chiqarishda
 * `XorazmApiClient` haqiqiy API'ga ulanadi.
 */
import type {
  AuditLogEntry,
  DashboardResponse,
  IntegrationListResponse,
  IntegrationSecretView,
} from '../contract/admin';
import type { AdminSession, AdminUser } from '../contract/auth';
import { permissionsForRoles } from '../contract/auth';
import type { AudioSubmission } from '../contract/audio';
import type { ContributionRequest } from '../contract/contributions';
import type { Dialect, Geofence, Region } from '../contract/geo';
import type { Word } from '../contract/words';
import { XORAZM_DEFAULT_GEOFENCE, XORAZM_REGION_SEED_ID } from '../geo/xorazm';
import { RULE_PACK_NAME, RULE_PACK_VERSION } from '../validation/lexicon';
import { phoneticKey } from '../validation/phonetics';

const NOW = '2026-08-10T08:00:00.000Z';
const stamp = { createdAt: NOW, updatedAt: NOW };

export const MOCK_USERS: AdminUser[] = [
  {
    id: 'u-admin',
    fullName: 'Demo administrator',
    email: 'admin@xorazmshevalari.uz',
    roles: ['admin'],
    assignedRegionIds: [],
    isActive: true,
    lastLoginAt: NOW,
  },
  {
    id: 'u-moderator',
    fullName: 'Gulnora Yusupova',
    email: 'moderator@xorazmshevalari.uz',
    roles: ['moderator'],
    assignedRegionIds: [XORAZM_REGION_SEED_ID],
    isActive: true,
    lastLoginAt: NOW,
  },
  {
    id: 'u-editor',
    fullName: 'Sardor Rahimov',
    email: 'editor@xorazmshevalari.uz',
    roles: ['editor'],
    assignedRegionIds: [XORAZM_REGION_SEED_ID],
    isActive: true,
    lastLoginAt: null,
  },
];

/** Demo login: parol hamma hisob uchun `demo1234`. */
export const MOCK_PASSWORD = 'demo1234';

export function mockSessionFor(user: AdminUser): AdminSession {
  return {
    user,
    permissions: permissionsForRoles(user.roles),
    accessToken: `mock.${user.id}.token`,
    accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    refreshToken: `mock.${user.id}.refresh`,
  };
}

export const MOCK_REGIONS: Region[] = [
  { id: XORAZM_REGION_SEED_ID, code: 'xorazm', nameUz: 'Xorazm viloyati', level: 'region', isContributionAllowed: true, wordCount: 1284, audioCount: 412, ...stamp },
  { id: 'r-urganch', code: 'urganch', nameUz: 'Urganch tumani', parentId: XORAZM_REGION_SEED_ID, level: 'district', isContributionAllowed: true, wordCount: 318, audioCount: 122, ...stamp },
  { id: 'r-xiva', code: 'xiva', nameUz: 'Xiva tumani', parentId: XORAZM_REGION_SEED_ID, level: 'district', isContributionAllowed: true, wordCount: 402, audioCount: 141, ...stamp },
  { id: 'r-shovot', code: 'shovot', nameUz: 'Shovot tumani', parentId: XORAZM_REGION_SEED_ID, level: 'district', isContributionAllowed: true, wordCount: 176, audioCount: 48, ...stamp },
  { id: 'r-gurlan', code: 'gurlan', nameUz: 'Gurlan tumani', parentId: XORAZM_REGION_SEED_ID, level: 'district', isContributionAllowed: true, wordCount: 143, audioCount: 39, ...stamp },
  { id: 'r-hazorasp', code: 'hazorasp', nameUz: 'Hazorasp tumani', parentId: XORAZM_REGION_SEED_ID, level: 'district', isContributionAllowed: true, wordCount: 121, audioCount: 33, ...stamp },
  { id: 'r-xonqa', code: 'xonqa', nameUz: 'Xonqa tumani', parentId: XORAZM_REGION_SEED_ID, level: 'district', isContributionAllowed: true, wordCount: 124, audioCount: 29, ...stamp },
];

export const MOCK_DIALECTS: Dialect[] = [
  { id: 'd-oguz', code: 'oguz', nameUz: 'O‘g‘uz', description: 'Xiva–Urganch o‘qi bo‘ylab keng tarqalgan.', markerWords: ['gel', 'git', 'gelyatir'], regionIds: ['r-xiva', 'r-urganch'], isActive: true, ...stamp },
  { id: 'd-qipchoq', code: 'qipchoq', nameUz: 'Qipchoq', description: 'Shimoliy tumanlarda uchraydi.', markerWords: ['jol', 'jaxshi'], regionIds: ['r-shovot', 'r-gurlan'], isActive: true, ...stamp },
  { id: 'd-aralash', code: 'oguz_qipchoq', nameUz: 'O‘g‘uz-Qipchoq', description: 'Chegaradosh hududlarda aralash shakllar.', markerWords: [], regionIds: ['r-xonqa', 'r-hazorasp'], isActive: true, ...stamp },
];

export const MOCK_GEOFENCES: Geofence[] = [XORAZM_DEFAULT_GEOFENCE];

function word(
  id: string,
  text: string,
  meaning: string,
  regionId: string,
  dialectId: string,
  extra: Partial<Word> = {},
): Word {
  return {
    id,
    word: text,
    meaning,
    phoneticKey: phoneticKey(text),
    status: 'published',
    regionId: XORAZM_REGION_SEED_ID,
    districtId: regionId,
    dialectId,
    dialectScore: 78,
    ...stamp,
    ...extra,
  };
}

export const MOCK_WORDS: Word[] = [
  word('w-1', 'gelyatir', 'kelyapti', 'r-xiva', 'd-oguz', { literaryForm: 'kelyapti', dialectScore: 92, category: 'fe’l' }),
  word('w-2', 'qarpiz', 'tarvuz', 'r-urganch', 'd-oguz', { literaryForm: 'tarvuz', dialectScore: 88, category: 'meva' }),
  word('w-3', 'gavun', 'qovun', 'r-urganch', 'd-oguz', { literaryForm: 'qovun', dialectScore: 86, category: 'meva' }),
  word('w-4', 'paqir', 'chelak', 'r-shovot', 'd-qipchoq', { literaryForm: 'chelak', dialectScore: 74, category: 'ro‘zg‘or' }),
  word('w-5', 'yanga', 'akaning xotini', 'r-gurlan', 'd-qipchoq', { dialectScore: 69, category: 'qarindoshlik' }),
  word('w-6', 'nema', 'nima', 'r-xonqa', 'd-aralash', { literaryForm: 'nima', dialectScore: 81 }),
  word('w-7', 'supra', 'xamir yoyiladigan mato', 'r-hazorasp', 'd-aralash', { dialectScore: 71, category: 'ro‘zg‘or' }),
  word('w-8', 'boldiz', 'xotinning singlisi', 'r-xiva', 'd-oguz', { dialectScore: 66, category: 'qarindoshlik' }),
  word('w-9', 'chorpoya', 'past taxta so‘ri', 'r-urganch', 'd-oguz', { dialectScore: 58, status: 'archived', archivedAt: NOW, archiveReason: 'Adabiy shakl bilan bir xil deb topildi' }),
];

const mockAudio = (id: string, expected: string, analyzed: boolean): AudioSubmission => ({
  id,
  storageKey: `audio/2026/08/${id}.m4a`,
  playbackUrl: null,
  playbackUrlExpiresAt: null,
  mimeType: 'audio/m4a',
  durationMs: analyzed ? 2400 : 1800,
  sizeBytes: 48_000,
  sampleRateHz: 44_100,
  checksumSha256: `sha256-${id}`,
  expectedText: expected,
  moderationStatus: 'pending',
  ...stamp,
  analysis: analyzed
    ? {
        status: 'analyzed',
        stage: 'completed',
        transcript: expected,
        transcriptConfidence: 0.82,
        detectedLanguage: 'uz',
        dialectConfidence: 0.71,
        pronunciationSimilarity: 88,
        textAudioMatch: 91,
        overallScore: 85,
        reasons: [],
        requiresHumanReview: true,
        engine: { kind: 'hybrid', name: RULE_PACK_NAME, version: RULE_PACK_VERSION, provider: 'stt_primary' },
        analyzedAt: NOW,
        failureMessage: null,
      }
    : {
        status: 'pending_analysis',
        stage: 'uploaded',
        transcript: null,
        transcriptConfidence: null,
        detectedLanguage: null,
        dialectConfidence: null,
        pronunciationSimilarity: null,
        textAudioMatch: null,
        overallScore: null,
        reasons: [
          {
            code: 'stt_unavailable',
            severity: 'info',
            scoreDelta: 0,
            message: 'Nutqni matnga o‘girish xizmati ulanmagan — audio moderator tekshiruviga qoldi.',
          },
        ],
        requiresHumanReview: true,
        engine: null,
        analyzedAt: null,
        failureMessage: null,
      },
});

export const MOCK_REQUESTS: ContributionRequest[] = [
  {
    id: 'req-1',
    type: 'word',
    status: 'pending',
    payload: { word: 'gitti', meaning: 'ketdi', literaryForm: 'ketdi', districtId: 'Xiva', dialectId: 'd-oguz' },
    submittedByDisplayName: 'Anonim foydalanuvchi',
    device: { platform: 'android', installationId: 'inst-a1', appVersion: '3.0.0' },
    latitude: 41.378,
    longitude: 60.364,
    locationAccuracyM: 18,
    locationCheckedAt: NOW,
    submissionLocationStatus: 'inside',
    matchedGeofenceId: XORAZM_DEFAULT_GEOFENCE.id,
    geofenceVersion: 1,
    validationVerdict: 'accepted_for_review',
    validationScore: 84,
    validationResults: [],
    audio: mockAudio('aud-1', 'gitti', true),
    ...stamp,
  },
  {
    id: 'req-2',
    type: 'word',
    status: 'pending',
    payload: { word: 'kartishka', meaning: 'kartoshka', districtId: 'Gurlan', dialectId: 'd-qipchoq' },
    submittedByDisplayName: 'Anonim foydalanuvchi',
    device: { platform: 'ios', installationId: 'inst-b2', appVersion: '3.0.0' },
    latitude: 41.85,
    longitude: 60.39,
    locationAccuracyM: 74,
    locationCheckedAt: NOW,
    submissionLocationStatus: 'inside_near_boundary',
    matchedGeofenceId: XORAZM_DEFAULT_GEOFENCE.id,
    geofenceVersion: 1,
    validationVerdict: 'needs_manual_review',
    validationScore: 47,
    validationResults: [],
    audio: mockAudio('aud-2', 'kartishka', false),
    ...stamp,
  },
  {
    id: 'req-3',
    type: 'word',
    status: 'pending',
    payload: { word: 'salom', meaning: 'salomlashish', districtId: 'Urganch' },
    submittedByDisplayName: 'Anonim foydalanuvchi',
    device: { platform: 'android', installationId: 'inst-c3', appVersion: '3.0.0' },
    latitude: 41.55,
    longitude: 60.63,
    locationAccuracyM: 25,
    locationCheckedAt: NOW,
    submissionLocationStatus: 'inside',
    validationVerdict: 'rejected',
    validationScore: 12,
    validationResults: [],
    audio: null,
    ...stamp,
  },
  {
    id: 'req-4',
    type: 'audio',
    status: 'needs_clarification',
    payload: { word: 'gavun', meaning: 'qovun', districtId: 'Urganch', dialectId: 'd-oguz' },
    submittedByDisplayName: 'Anonim foydalanuvchi',
    device: { platform: 'android', installationId: 'inst-d4', appVersion: '3.0.0' },
    latitude: 41.5,
    longitude: 60.6,
    locationAccuracyM: 12,
    locationCheckedAt: NOW,
    submissionLocationStatus: 'inside',
    validationVerdict: 'needs_manual_review',
    validationScore: 61,
    validationResults: [],
    clarificationNote: 'Audio juda shovqinli — iltimos, tinch joyda qayta yozib yuboring.',
    audio: mockAudio('aud-4', 'gavun', false),
    ...stamp,
  },
  {
    id: 'req-5',
    type: 'word',
    status: 'approved',
    payload: { word: 'qarpiz', meaning: 'tarvuz', districtId: 'Urganch', dialectId: 'd-oguz' },
    submittedByDisplayName: 'Anonim foydalanuvchi',
    latitude: 41.54,
    longitude: 60.62,
    locationAccuracyM: 9,
    locationCheckedAt: NOW,
    submissionLocationStatus: 'inside',
    validationVerdict: 'accepted_for_review',
    validationScore: 88,
    validationResults: [],
    resolvedAt: NOW,
    resolvedByUserId: 'u-moderator',
    resultWordId: 'w-2',
    audio: null,
    ...stamp,
  },
];

export const MOCK_AUDIO_QUEUE: AudioSubmission[] = MOCK_REQUESTS.map((r) => r.audio).filter(
  (a): a is AudioSubmission => !!a,
);

export const MOCK_DASHBOARD: DashboardResponse = {
  counters: {
    pendingRequests: 3,
    approvedToday: 12,
    rejectedToday: 4,
    needsClarification: 1,
    audioQueue: 3,
    audioPendingAnalysis: 2,
    flaggedLocation: 1,
    totalWords: 1284,
    totalAudio: 412,
  },
  regionStats: [
    { regionId: 'r-xiva', regionName: 'Xiva', wordCount: 402, audioCount: 141, pendingCount: 1, avgDialectScore: 82 },
    { regionId: 'r-urganch', regionName: 'Urganch', wordCount: 318, audioCount: 122, pendingCount: 1, avgDialectScore: 79 },
    { regionId: 'r-shovot', regionName: 'Shovot', wordCount: 176, audioCount: 48, pendingCount: 0, avgDialectScore: 71 },
    { regionId: 'r-gurlan', regionName: 'Gurlan', wordCount: 143, audioCount: 39, pendingCount: 1, avgDialectScore: 68 },
    { regionId: 'r-hazorasp', regionName: 'Hazorasp', wordCount: 121, audioCount: 33, pendingCount: 0, avgDialectScore: 66 },
    { regionId: 'r-xonqa', regionName: 'Xonqa', wordCount: 124, audioCount: 29, pendingCount: 0, avgDialectScore: 64 },
  ],
  recentQueue: MOCK_REQUESTS.slice(0, 4).map((r) => ({
    id: r.id,
    title: r.payload.word,
    subtitle: r.payload.meaning,
    status: r.status,
    score: r.validationScore,
    hasAudio: !!r.audio,
    flagged: r.submissionLocationStatus !== 'inside',
    createdAt: r.createdAt,
  })),
  trend: [
    { date: '2026-08-04', submitted: 14, approved: 9, rejected: 3 },
    { date: '2026-08-05', submitted: 18, approved: 11, rejected: 4 },
    { date: '2026-08-06', submitted: 11, approved: 8, rejected: 2 },
    { date: '2026-08-07', submitted: 22, approved: 15, rejected: 5 },
    { date: '2026-08-08', submitted: 19, approved: 12, rejected: 3 },
    { date: '2026-08-09', submitted: 16, approved: 10, rejected: 4 },
    { date: '2026-08-10', submitted: 9, approved: 12, rejected: 4 },
  ],
  generatedAt: NOW,
};

export const MOCK_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: 'al-1',
    action: 'request.status_change',
    entityType: 'contribution_request',
    entityId: 'req-5',
    actorId: 'u-moderator',
    actorName: 'Gulnora Yusupova',
    actorRoles: ['moderator'],
    ipAddress: '84.54.72.0',
    before: { status: 'pending' },
    after: { status: 'approved', resultWordId: 'w-2' },
    changedFields: ['status', 'resultWordId'],
    reason: 'Sheva mosligi tasdiqlandi',
    createdAt: '2026-08-10T07:41:00.000Z',
  },
  {
    id: 'al-2',
    action: 'geofence.update',
    entityType: 'geofence',
    entityId: XORAZM_DEFAULT_GEOFENCE.id,
    actorId: 'u-admin',
    actorName: 'Demo administrator',
    actorRoles: ['admin'],
    ipAddress: '84.54.72.0',
    before: { 'policy.maxAccuracyM': 150 },
    after: { 'policy.maxAccuracyM': 100 },
    changedFields: ['policy.maxAccuracyM'],
    reason: 'Chegara yaqinidagi noaniqlikni kamaytirish',
    createdAt: '2026-08-10T06:12:00.000Z',
  },
  {
    id: 'al-3',
    action: 'integration.rotate',
    entityType: 'integration_secret',
    entityId: 'stt_primary',
    actorId: 'u-admin',
    actorName: 'Demo administrator',
    actorRoles: ['admin'],
    ipAddress: '84.54.72.0',
    before: { maskedHint: '••••4c11', keyVersion: 2 },
    after: { maskedHint: '••••7f2a', keyVersion: 3 },
    changedFields: ['secretValue', 'keyVersion'],
    reason: 'Rejali almashtirish',
    createdAt: '2026-08-09T18:05:00.000Z',
  },
  {
    id: 'al-4',
    action: 'word.archive',
    entityType: 'word',
    entityId: 'w-9',
    actorId: 'u-admin',
    actorName: 'Demo administrator',
    actorRoles: ['admin'],
    before: { status: 'published' },
    after: { status: 'archived' },
    changedFields: ['status'],
    reason: 'Adabiy shakl bilan bir xil deb topildi',
    createdAt: '2026-08-09T14:22:00.000Z',
  },
  {
    id: 'al-5',
    action: 'auth.login',
    entityType: 'user',
    entityId: 'u-moderator',
    actorId: 'u-moderator',
    actorName: 'Gulnora Yusupova',
    actorRoles: ['moderator'],
    ipAddress: '84.54.72.0',
    changedFields: [],
    createdAt: '2026-08-10T05:58:00.000Z',
  },
];

const integration = (
  provider: IntegrationSecretView['provider'],
  displayName: string,
  configured: boolean,
  extra: Partial<IntegrationSecretView> = {},
): IntegrationSecretView => ({
  provider,
  displayName,
  isConfigured: configured,
  maskedHint: configured ? '••••7f2a' : null,
  keyVersion: configured ? 3 : null,
  lastRotatedAt: configured ? '2026-08-09T18:05:00.000Z' : null,
  lastRotatedBy: configured ? 'Demo administrator' : null,
  lastUsedAt: configured ? NOW : null,
  health: configured ? 'ok' : 'not_configured',
  healthCheckedAt: configured ? NOW : null,
  publicConfig: {},
  isEnabled: configured,
  ...extra,
});

export const MOCK_INTEGRATIONS: IntegrationListResponse = {
  items: [
    integration('stt_primary', 'Asosiy STT (nutq → matn)', false, { publicConfig: { provider: 'Groq', model: 'whisper-large-v3', language: 'uz' } }),
    integration('stt_fallback', 'Zaxira STT', false),
    integration('dialect_model', 'Sheva aniqlash modeli', false, { health: 'not_configured' }),
    integration('pronunciation_model', 'Talaffuz baholash', false),
    integration('moderation_ai', 'Matn moderatsiyasi (AI)', false, { health: 'not_configured' }),
    integration('object_storage', 'Audio saqlash', false, { publicConfig: { provider: 'Supabase Storage' } }),
    integration('push_notifications', 'Push bildirishnomalar', false),
  ],
  encryption: { algorithm: 'AES-256-GCM (envelope)', keySource: 'env_master_key', currentKeyVersion: 3 },
};
