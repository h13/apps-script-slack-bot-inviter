import {
  buildAuthPrompt,
  buildEnqueuedMessage,
  buildInviteSummary,
  buildTargetErrorMessage,
  buildTokenInvalidMessage,
} from '../src/messages.js';
import type { InviteResult } from '../src/config.js';

const channel = (
  id: string,
  name: string,
  isPrivate: boolean,
): InviteResult['channel'] => ({ id, name, isPrivate });

describe('buildAuthPrompt', () => {
  it('contains the authorize link', () => {
    const msg = buildAuthPrompt('https://slack.com/oauth/v2/authorize?x=1');
    expect(msg).toContain('<https://slack.com/oauth/v2/authorize?x=1|');
  });
});

describe('buildEnqueuedMessage', () => {
  it('names the target bot', () => {
    expect(buildEnqueuedMessage('archiver')).toContain('`archiver`');
  });
});

describe('buildTargetErrorMessage', () => {
  it('explains when no bots are configured', () => {
    expect(buildTargetErrorMessage({ kind: 'none-configured' })).toContain(
      'TARGET_BOTS',
    );
  });

  it('lists aliases when the command is ambiguous', () => {
    const msg = buildTargetErrorMessage({
      kind: 'ambiguous',
      aliases: ['archiver', 'deploy-bot'],
    });
    expect(msg).toContain('`archiver`');
    expect(msg).toContain('`deploy-bot`');
  });

  it('echoes the unknown input and lists aliases', () => {
    const msg = buildTargetErrorMessage({
      kind: 'unknown',
      input: 'nope',
      aliases: ['archiver'],
    });
    expect(msg).toContain('nope');
    expect(msg).toContain('`archiver`');
  });
});

describe('buildInviteSummary', () => {
  const results: readonly InviteResult[] = [
    { channel: channel('C1', 'general-dev', false), outcome: 'invited' },
    { channel: channel('G1', 'secret-plans', true), outcome: 'invited' },
    { channel: channel('G2', 'ops', true), outcome: 'already_in' },
    {
      channel: channel('G3', 'broken', true),
      outcome: 'failed',
      error: 'cant_invite',
    },
  ];

  it('reports counts for each outcome', () => {
    const msg = buildInviteSummary('archiver', results, { truncated: false });
    expect(msg).toContain('2');
    expect(msg).toContain('1');
  });

  it('marks private channels with a lock icon', () => {
    const msg = buildInviteSummary('archiver', results, { truncated: false });
    expect(msg).toContain(':lock: secret-plans');
  });

  it('lists failures with their error code', () => {
    const msg = buildInviteSummary('archiver', results, { truncated: false });
    expect(msg).toContain('broken');
    expect(msg).toContain('cant_invite');
  });

  it('notes truncation when the run hit the time budget', () => {
    const msg = buildInviteSummary('archiver', results, { truncated: true });
    expect(msg.toLowerCase()).toContain('time');
  });

  it('handles an empty channel list', () => {
    const msg = buildInviteSummary('archiver', [], { truncated: false });
    expect(msg).toContain('no channels');
  });

  it('caps the invited list and reports the remainder', () => {
    const many: readonly InviteResult[] = Array.from(
      { length: 60 },
      (_, i) => ({
        channel: channel(`G${i}`, `room-${i}`, true),
        outcome: 'invited' as const,
      }),
    );
    const msg = buildInviteSummary('archiver', many, { truncated: false });
    expect(msg).toContain('room-0');
    expect(msg).not.toContain('room-59');
    expect(msg).toContain('more');
  });
});

describe('buildTokenInvalidMessage', () => {
  it('contains the re-authorize link', () => {
    const msg = buildTokenInvalidMessage('https://example.test/auth');
    expect(msg).toContain('<https://example.test/auth|');
  });
});
