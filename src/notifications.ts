/**
 * Bildirishnomalar.
 *
 * Bu yerda ikki xil kod bor va ular ataylab ajratilgan:
 *
 * 1. Sof funksiyalar — qaysi holat qanday matnga aylanishini hal qiladi.
 *    Ular bazaga tegmaydi, shuning uchun testdan o'tadi.
 * 2. `deliver()` — yozib qo'yish. U `PoolClient` ham, `Pool` ham qabul
 *    qiladi, ya'ni chaqiruvchi uni moderator qarori bilan bitta
 *    tranzaksiyada bajarishni tanlashi mumkin.
 *
 * Yetkazish qatlami (push) bu modulda yo'q. Ichki inbox mustaqil ishlaydi;
 * push faqat uning ustiga qo'yiladigan transport bo'ladi.
 */

export type NotificationType =
  | 'WORD_SUBMITTED'
  | 'WORD_RESUBMITTED'
  | 'AUDIO_SUBMITTED'
  | 'WORD_APPROVED'
  | 'WORD_REVISION_REQUESTED'
  | 'WORD_REJECTED'
  | 'AUDIO_APPROVED'
  | 'AUDIO_REVISION_REQUESTED'
  | 'AUDIO_REJECTED'
  | 'COMMENT_CREATED'
  | 'COMMENT_REPLY'
  | 'LIKE_RECEIVED'
  | 'ACCOUNT_BLOCKED'
  | 'ACCOUNT_UNBLOCKED'
  | 'SYSTEM';

export type NotificationEntityType =
  | 'word'
  | 'contribution_request'
  | 'audio_submission'
  | 'word_comment'
  | 'user'
  | 'none';

export interface NotificationDraft {
  recipientUserId: string;
  actorUserId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  entityType: NotificationEntityType;
  entityId?: string | null;
  data?: Record<string, unknown>;
}

/** Bazaga yozadigan minimal interfeys — `Pool` ham, `PoolClient` ham mos keladi. */
export interface QueryExecutor {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

type ModerationDecision = 'approved' | 'rejected' | 'needs_clarification';

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Sabab foydalanuvchiga ko'rsatiladi, lekin bildirishnoma matni cheklangan.
 * Uzun sababni kesib, to'liq matnni ekranda ko'rsatamiz — shuning uchun bu
 * yerda qisqartirish yo'qotish emas.
 */
function withReason(base: string, reason: string | null | undefined): string {
  const text = reason?.trim();
  return text ? `${base} Sabab: ${clip(text, 300)}` : base;
}

/** Moderator so'z taklifi bo'yicha qaror qabul qilganda foydalanuvchiga. */
export function wordDecisionNotification(
  decision: ModerationDecision,
  word: string,
  reason: string | null | undefined,
): { type: NotificationType; title: string; body: string } {
  const name = clip(word, 60);
  switch (decision) {
    case 'approved':
      return {
        type: 'WORD_APPROVED',
        title: 'So‘zingiz tasdiqlandi',
        body: `«${name}» lug‘atga qo‘shildi. Rahmat — meros shu tarzda saqlanadi.`,
      };
    case 'needs_clarification':
      return {
        type: 'WORD_REVISION_REQUESTED',
        title: 'So‘zingiz aniqlashtirishni talab qiladi',
        body: withReason(`«${name}» bo‘yicha moderator qo‘shimcha ma’lumot so‘radi.`, reason),
      };
    case 'rejected':
      return {
        type: 'WORD_REJECTED',
        title: 'So‘zingiz qabul qilinmadi',
        body: withReason(`«${name}» lug‘atga kiritilmadi.`, reason),
      };
  }
}

/** Moderator talaffuz yozuvi bo'yicha qaror qabul qilganda. */
export function audioDecisionNotification(
  decision: ModerationDecision,
  word: string,
  reason: string | null | undefined,
): { type: NotificationType; title: string; body: string } {
  const name = clip(word, 60);
  switch (decision) {
    case 'approved':
      return {
        type: 'AUDIO_APPROVED',
        title: 'Talaffuzingiz tasdiqlandi',
        body: `«${name}» so‘zining talaffuzi lug‘atda eshitiladigan bo‘ldi.`,
      };
    case 'needs_clarification':
      return {
        type: 'AUDIO_REVISION_REQUESTED',
        title: 'Talaffuzni qayta yozish so‘raldi',
        body: withReason(`«${name}» uchun yangi yozuv kerak.`, reason),
      };
    case 'rejected':
      return {
        type: 'AUDIO_REJECTED',
        title: 'Talaffuz qabul qilinmadi',
        body: withReason(`«${name}» talaffuz yozuvi rad etildi.`, reason),
      };
  }
}

/** Yangi (yoki qayta yuborilgan) taklif kelganda moderatorlarga. */
export function submissionNotification(
  kind: 'new' | 'resubmitted',
  word: string,
  submitterName: string | null,
): { type: NotificationType; title: string; body: string } {
  const name = clip(word, 60);
  const who = submitterName?.trim() ? clip(submitterName, 40) : 'Mehmon foydalanuvchi';
  return kind === 'new'
    ? { type: 'WORD_SUBMITTED', title: 'Yangi so‘z taklifi', body: `${who} «${name}» so‘zini yubordi.` }
    : { type: 'WORD_RESUBMITTED', title: 'Taklif qayta yuborildi', body: `${who} «${name}» bo‘yicha aniqlashtirilgan javob yubordi.` };
}

/** Talaffuz yozuvi kelganda moderatorlarga. */
export function audioSubmissionNotification(
  word: string,
  submitterName: string | null,
): { type: NotificationType; title: string; body: string } {
  const who = submitterName?.trim() ? clip(submitterName, 40) : 'Mehmon foydalanuvchi';
  return {
    type: 'AUDIO_SUBMITTED',
    title: 'Yangi talaffuz yozuvi',
    body: `${who} «${clip(word, 60)}» so‘zi uchun audio yubordi.`,
  };
}

/** So'zga izoh yozilganda uning muallifiga. */
export function commentNotification(
  actorName: string,
  word: string,
  body: string,
): { type: NotificationType; title: string; body: string } {
  return {
    type: 'COMMENT_CREATED',
    title: 'So‘zingizga izoh yozildi',
    body: `${clip(actorName, 40)} «${clip(word, 40)}» haqida: ${clip(body, 160)}`,
  };
}

/** Izohga javob yozilganda javob berilgan izoh muallifiga. */
export function replyNotification(
  actorName: string,
  word: string,
  body: string,
): { type: NotificationType; title: string; body: string } {
  return {
    type: 'COMMENT_REPLY',
    title: 'Izohingizga javob keldi',
    body: `${clip(actorName, 40)} «${clip(word, 40)}» ostida javob yozdi: ${clip(body, 160)}`,
  };
}

/** So'z yoqtirilganda uning muallifiga. */
export function likeNotification(
  actorName: string,
  word: string,
): { type: NotificationType; title: string; body: string } {
  return {
    type: 'LIKE_RECEIVED',
    title: 'So‘zingiz yoqdi',
    body: `${clip(actorName, 40)} «${clip(word, 40)}» so‘zini yoqtirdi.`,
  };
}

/**
 * O'ziga o'zi xabar bermaslik va bir odamga bir xil xabarni ikki marta
 * yubormaslik.
 *
 * Ikkalasi ham talab: foydalanuvchi o'z izohidan yoki o'z so'zini o'zi
 * yoqtirganidan xabar olmasligi kerak, moderator esa bitta taklif uchun
 * bir nechta rolga ega bo'lsa ham bitta xabar olishi kerak.
 */
export function usefulDrafts(drafts: readonly NotificationDraft[]): NotificationDraft[] {
  const seen = new Set<string>();
  const result: NotificationDraft[] = [];
  for (const draft of drafts) {
    if (!draft.recipientUserId) continue;
    if (draft.actorUserId && draft.actorUserId === draft.recipientUserId) continue;
    const key = `${draft.recipientUserId}|${draft.type}|${draft.entityId ?? ''}|${draft.actorUserId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(draft);
  }
  return result;
}

/**
 * Bildirishnomalarni yozadi.
 *
 * `LIKE_RECEIVED` uchun bazada qisman unikal indeks bor: yoqtirish tugmasi
 * ketma-ket bosilganda egasiga bir necha xabar bormaydi. Shuning uchun
 * `ON CONFLICT DO NOTHING` — bu xato emas, kutilgan holat.
 */
export async function deliver(
  executor: QueryExecutor,
  drafts: readonly NotificationDraft[],
): Promise<number> {
  const useful = usefulDrafts(drafts);
  if (!useful.length) return 0;

  let written = 0;
  for (const draft of useful) {
    const result = await executor.query(
      `INSERT INTO notifications (recipient_user_id, actor_user_id, type, title, body, entity_type, entity_id, data)
       VALUES ($1::uuid, $2::uuid, $3::notification_type, $4, $5, $6::notification_entity_type, $7, $8::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        draft.recipientUserId,
        draft.actorUserId ?? null,
        draft.type,
        draft.title,
        draft.body,
        draft.entityType,
        draft.entityId ?? null,
        JSON.stringify(draft.data ?? {}),
      ],
    );
    written += result.rowCount ?? 0;
  }
  return written;
}

/**
 * Moderatsiya bildirishnomasini kim olishi kerak.
 *
 * Ro'yxat rollardan hisoblanadi, qo'lda yozilmaydi: yangi moderator
 * qo'shilganda u avtomatik navbat xabarlarini oladi va rol olib
 * qo'yilganda darhol to'xtaydi.
 */
export async function moderationRecipients(executor: QueryExecutor): Promise<string[]> {
  const result = await executor.query(
    `SELECT DISTINCT u.id::text AS id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.kind = 'staff'
        AND u.is_active = true
        AND u.blocked_at IS NULL
        AND $1 = ANY(r.permissions)`,
    ['requests:moderate'],
  );
  return result.rows.map((row) => String(row.id));
}

/** O'qilmagan bildirishnomalar soni — ekran chizishdan oldin so'raladi. */
export async function unreadCount(executor: QueryExecutor, userId: string): Promise<number> {
  const result = await executor.query(
    'SELECT count(*)::int AS unread FROM notifications WHERE recipient_user_id = $1::uuid AND read_at IS NULL',
    [userId],
  );
  return Number(result.rows[0]?.unread ?? 0);
}
