import { KbMember, KbRole, KnowledgeBase } from './kb.models';

export const KB_ID = '11111111-1111-4111-8111-111111111111';

export function makeKb(over: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: KB_ID,
    name: 'HR handbook',
    description: 'Policies and onboarding',
    myRole: 'Owner',
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-02T10:00:00Z',
    rowVersion: 'AAAAAAAAB9E=',
    ...over,
  };
}

export function makeMember(over: Partial<KbMember> = {}): KbMember {
  return {
    userId: '22222222-2222-4222-8222-222222222222',
    displayName: 'Grace Hopper',
    email: 'grace@example.com',
    role: 'Editor' as KbRole,
    ...over,
  };
}

export const problemBody = (status: number, type: string, correlationId = 'cid-9') => ({
  type,
  title: 'Problem',
  status,
  traceId: '00-abc',
  correlationId,
  detail: 'SERVER DETAIL MUST NOT BE SHOWN',
});
