import type { InviteResult, TargetResolution } from './config.js';

/** Max channel names listed per section before collapsing to "+N more". */
const MAX_LISTED_CHANNELS = 30;

export function buildAuthPrompt(authorizeUrl: string): string {
  return [
    ':wave: Before I can invite bots for you, I need your permission to act',
    'on the channels you belong to.',
    `→ <${authorizeUrl}|Authorize bot-inviter>, then run the command again.`,
  ].join('\n');
}

export function buildEnqueuedMessage(alias: string): string {
  return (
    `:hourglass_flowing_sand: Inviting \`${alias}\` to all channels you ` +
    'belong to… Results will be posted here within a minute.'
  );
}

export function buildTargetErrorMessage(
  resolution: Exclude<TargetResolution, { kind: 'ok' }>,
): string {
  switch (resolution.kind) {
    case 'none-configured':
      return (
        ':warning: No target bots are configured. Ask the administrator to ' +
        'set the `TARGET_BOTS` Script Property (see the README).'
      );
    case 'ambiguous':
      return (
        ':thinking_face: Which bot should I invite? Available: ' +
        formatAliases(resolution.aliases) +
        '\nUsage: `/bot-inviter <bot-alias>`'
      );
    case 'unknown':
      return (
        `:warning: Unknown bot "${resolution.input}". Available: ` +
        formatAliases(resolution.aliases)
      );
  }
}

export function buildInviteSummary(
  alias: string,
  results: readonly InviteResult[],
  opts: { readonly truncated: boolean },
): string {
  if (results.length === 0 && !opts.truncated) {
    return `:shrug: Found no channels to invite \`${alias}\` to.`;
  }

  const invited = results.filter((r) => r.outcome === 'invited');
  const alreadyIn = results.filter((r) => r.outcome === 'already_in');
  const failed = results.filter((r) => r.outcome === 'failed');

  const header =
    `:white_check_mark: \`${alias}\` — invited: *${invited.length}*, ` +
    `already in: *${alreadyIn.length}*, failed: *${failed.length}*`;

  const invitedSection =
    invited.length > 0
      ? ['\n*Invited:*', formatChannelList(invited)].join('\n')
      : '';

  const failedSection =
    failed.length > 0
      ? [
          '\n*Failed:*',
          ...failed.map(
            (r) => `• ${channelLabel(r)} — \`${r.error ?? 'unknown_error'}\``,
          ),
        ].join('\n')
      : '';

  const truncatedNote = opts.truncated
    ? '\n:warning: Stopped early (execution time budget). Run the command again to continue.'
    : '';

  return [header, invitedSection, failedSection, truncatedNote]
    .filter((section) => section !== '')
    .join('\n');
}

export function buildTokenInvalidMessage(authorizeUrl: string): string {
  return [
    ':key: Your authorization is no longer valid (revoked or expired).',
    `→ <${authorizeUrl}|Re-authorize bot-inviter>, then run the command again.`,
  ].join('\n');
}

function formatAliases(aliases: readonly string[]): string {
  return aliases.map((alias) => `\`${alias}\``).join(', ');
}

function channelLabel(result: InviteResult): string {
  const icon = result.channel.isPrivate ? ':lock: ' : '#';
  return `${icon}${result.channel.name}`;
}

function formatChannelList(results: readonly InviteResult[]): string {
  const listed = results.slice(0, MAX_LISTED_CHANNELS);
  const lines = listed.map((r) => `• ${channelLabel(r)}`);
  const remainder = results.length - listed.length;
  const more = remainder > 0 ? [`• …and ${remainder} more`] : [];
  return [...lines, ...more].join('\n');
}
