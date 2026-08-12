import type { IsoDateTime, Uuid } from './common';

export interface CreateWordCommentRequest { installationId: string; body: string; }
export interface CommunityComment { id: Uuid; wordId: Uuid; body: string; createdAt: IsoDateTime; }
export interface WordCommunityState { likedByCurrentInstallation: boolean; likesCount: number; comments: CommunityComment[]; }
