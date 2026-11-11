import { parseTargetBots, resolveTarget } from '../src/target-bots.js';

describe('parseTargetBots', () => {
  it('parses a single entry', () => {
    expect(parseTargetBots('archiver=U0123ABCD')).toEqual([
      { alias: 'archiver', botUserId: 'U0123ABCD' },
    ]);
  });

  it('parses multiple comma-separated entries with whitespace', () => {
    expect(
      parseTargetBots(' archiver=U0123ABCD , deploy-bot=W0456EFGH '),
    ).toEqual([
      { alias: 'archiver', botUserId: 'U0123ABCD' },
      { alias: 'deploy-bot', botUserId: 'W0456EFGH' },
    ]);
  });

  it('ignores empty segments', () => {
    expect(parseTargetBots('archiver=U0123ABCD,,')).toEqual([
      { alias: 'archiver', botUserId: 'U0123ABCD' },
    ]);
  });

  it('throws on an entry without "="', () => {
    expect(() => parseTargetBots('archiver')).toThrow(/alias=BOT_USER_ID/);
  });

  it('throws on an invalid alias', () => {
    expect(() => parseTargetBots('bad alias=U0123ABCD')).toThrow(/alias/);
  });

  it('throws on an invalid bot user ID', () => {
    expect(() => parseTargetBots('archiver=B0123ABCD')).toThrow(/bot user ID/);
  });

  it('throws on duplicate aliases', () => {
    expect(() => parseTargetBots('a=U0123ABCD,a=U0456EFGH')).toThrow(
      /duplicate/i,
    );
  });
});

describe('resolveTarget', () => {
  const bots = [
    { alias: 'archiver', botUserId: 'U0123ABCD' },
    { alias: 'deploy-bot', botUserId: 'W0456EFGH' },
  ] as const;

  it('resolves an exact alias', () => {
    expect(resolveTarget('archiver', bots)).toEqual({
      kind: 'ok',
      bot: { alias: 'archiver', botUserId: 'U0123ABCD' },
    });
  });

  it('resolves case-insensitively and trims whitespace', () => {
    expect(resolveTarget('  ARCHIVER ', bots)).toEqual({
      kind: 'ok',
      bot: { alias: 'archiver', botUserId: 'U0123ABCD' },
    });
  });

  it('defaults to the only bot when text is empty', () => {
    const single = [{ alias: 'archiver', botUserId: 'U0123ABCD' }] as const;
    expect(resolveTarget('', single)).toEqual({
      kind: 'ok',
      bot: { alias: 'archiver', botUserId: 'U0123ABCD' },
    });
  });

  it('is ambiguous when text is empty and multiple bots are configured', () => {
    expect(resolveTarget('', bots)).toEqual({
      kind: 'ambiguous',
      aliases: ['archiver', 'deploy-bot'],
    });
  });

  it('reports unknown aliases', () => {
    expect(resolveTarget('nope', bots)).toEqual({
      kind: 'unknown',
      input: 'nope',
      aliases: ['archiver', 'deploy-bot'],
    });
  });

  it('reports when no bots are configured', () => {
    expect(resolveTarget('archiver', [])).toEqual({ kind: 'none-configured' });
  });
});
