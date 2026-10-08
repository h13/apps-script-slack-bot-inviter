/** Script Properties set once by the deployer (never per user). */
export const SCRIPT_PROPERTY_KEYS = {
  clientId: 'SLACK_CLIENT_ID',
  clientSecret: 'SLACK_CLIENT_SECRET',
  verificationToken: 'SLACK_VERIFICATION_TOKEN',
  targetBots: 'TARGET_BOTS',
  includePublicChannels: 'INCLUDE_PUBLIC_CHANNELS',
} as const;

/** Per-user OAuth tokens are stored as `USER_TOKEN_<SlackUserID>`. */
export const USER_TOKEN_PREFIX = 'USER_TOKEN_';

/** Pending invite jobs are stored as `JOB_<uuid>`. */
export const JOB_PREFIX = 'JOB_';

/** OAuth `state` nonces live in CacheService for this long. */
export const OAUTH_STATE_TTL_SECONDS = 600;

/** Stop inviting before the GAS 6-minute execution limit kills the run. */
export const MAX_RUNTIME_MS = 5 * 60 * 1000;

/** User scopes requested from each person who authorizes the app. */
export const USER_OAUTH_SCOPES = [
  'channels:read',
  'groups:read',
  'channels:write.invites',
  'groups:write.invites',
] as const;

/** Slack user IDs look like U…/W…; bots get regular user IDs too. */
export const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]{2,}$/;

export interface TargetBot {
  readonly alias: string;
  readonly botUserId: string;
}

export type TargetResolution =
  | { readonly kind: 'ok'; readonly bot: TargetBot }
  | { readonly kind: 'none-configured' }
  | { readonly kind: 'ambiguous'; readonly aliases: readonly string[] }
  | {
      readonly kind: 'unknown';
      readonly input: string;
      readonly aliases: readonly string[];
    };

export interface SlackChannel {
  readonly id: string;
  readonly name: string;
  readonly isPrivate: boolean;
}

export type InviteOutcome = 'invited' | 'already_in' | 'failed';

export interface InviteResult {
  readonly channel: SlackChannel;
  readonly outcome: InviteOutcome;
  readonly error?: string;
}

export interface InviteJob {
  readonly userId: string;
  readonly botUserId: string;
  readonly botAlias: string;
  readonly responseUrl: string;
  readonly enqueuedAt: string;
}
