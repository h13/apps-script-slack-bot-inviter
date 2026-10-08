import { SLACK_USER_ID_PATTERN } from './config.js';
import type { TargetBot, TargetResolution } from './config.js';

const ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Parse the `TARGET_BOTS` Script Property.
 *
 * Format: `alias=BOT_USER_ID[,alias=BOT_USER_ID...]`,
 * e.g. `archiver=U0123ABCD,deploy-bot=W0456EFGH`.
 *
 * @throws Error with a setup hint when an entry is malformed, so the
 *   deployer sees the exact problem instead of a silent misfire.
 */
export function parseTargetBots(raw: string): readonly TargetBot[] {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

  const bots = entries.map((entry): TargetBot => {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex === -1) {
      throw new Error(
        `TARGET_BOTS entry "${entry}" is malformed — expected alias=BOT_USER_ID`,
      );
    }
    const alias = entry.slice(0, separatorIndex).trim();
    const botUserId = entry.slice(separatorIndex + 1).trim();
    if (!ALIAS_PATTERN.test(alias)) {
      throw new Error(
        `TARGET_BOTS alias "${alias}" is invalid — use letters, digits, "-" and "_"`,
      );
    }
    if (!SLACK_USER_ID_PATTERN.test(botUserId)) {
      throw new Error(
        `TARGET_BOTS value "${botUserId}" is not a bot user ID (expected U…/W…, ` +
          'copy it from the bot profile → three-dot menu → Copy member ID)',
      );
    }
    return { alias, botUserId };
  });

  const seen = new Set<string>();
  for (const bot of bots) {
    const key = bot.alias.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`TARGET_BOTS has a duplicate alias "${bot.alias}"`);
    }
    seen.add(key);
  }

  return bots;
}

/**
 * Resolve the slash-command text to a configured bot.
 * Empty text is allowed when exactly one bot is configured.
 */
export function resolveTarget(
  text: string,
  bots: readonly TargetBot[],
): TargetResolution {
  if (bots.length === 0) {
    return { kind: 'none-configured' };
  }

  const aliases = bots.map((bot) => bot.alias);
  const input = text.trim();

  if (input === '') {
    return bots.length === 1
      ? { kind: 'ok', bot: bots[0]! }
      : { kind: 'ambiguous', aliases };
  }

  const match = bots.find(
    (bot) => bot.alias.toLowerCase() === input.toLowerCase(),
  );
  return match !== undefined
    ? { kind: 'ok', bot: match }
    : { kind: 'unknown', input, aliases };
}
