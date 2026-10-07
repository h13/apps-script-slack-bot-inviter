/**
 * Slack Web API wrapper (stateless, token passed as argument).
 * Excluded from unit coverage — UrlFetchApp cannot run in Node.js.
 */
import type { InviteOutcome, SlackChannel } from './config.js';

/** Errors that mean the stored user token is dead and must be re-issued. */
const AUTH_ERRORS: readonly string[] = [
  'invalid_auth',
  'token_revoked',
  'token_expired',
  'account_inactive',
  'not_authed',
];

export function isAuthError(error: string): boolean {
  return AUTH_ERRORS.includes(error);
}

type SlackApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

function slackApi<T>(
  token: string,
  endpoint: string,
  params: Record<string, string>,
  method: 'get' | 'post',
): SlackApiResult<T> {
  const fetchOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  };

  let url: string;
  if (method === 'post') {
    url = `https://slack.com/api/${endpoint}`;
    fetchOptions.method = 'post';
    fetchOptions.contentType = 'application/json';
    fetchOptions.payload = JSON.stringify(params);
  } else {
    const query = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    url = `https://slack.com/api/${endpoint}${query ? `?${query}` : ''}`;
  }

  try {
    const response = UrlFetchApp.fetch(url, fetchOptions);
    const json = JSON.parse(response.getContentText()) as {
      ok: boolean;
      error?: string;
    } & T;
    return json.ok
      ? { ok: true, data: json }
      : { ok: false, error: json.error ?? 'unknown_error' };
  } catch (error) {
    return { ok: false, error: `fetch_failed: ${String(error)}` };
  }
}

interface UsersConversationsResponse {
  readonly channels: readonly {
    readonly id: string;
    readonly name: string;
    readonly is_private: boolean;
  }[];
  readonly response_metadata?: { readonly next_cursor?: string };
}

/** Hard cap on pagination so a huge workspace cannot loop forever. */
const MAX_PAGES = 50;

/**
 * List channels the token's user is a member of, via `users.conversations`.
 * Private channels only by default; public ones are opt-in because most
 * bots can join those themselves (`conversations.join`).
 */
export function fetchMemberChannels(
  token: string,
  includePublic: boolean,
):
  | { readonly ok: true; readonly channels: readonly SlackChannel[] }
  | { readonly ok: false; readonly error: string } {
  const types = includePublic
    ? 'public_channel,private_channel'
    : 'private_channel';

  const allChannels: SlackChannel[] = [];
  let cursor = '';

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params: Record<string, string> = {
      types,
      exclude_archived: 'true',
      limit: '200',
    };
    if (cursor !== '') {
      params['cursor'] = cursor;
    }

    const result = slackApi<UsersConversationsResponse>(
      token,
      'users.conversations',
      params,
      'get',
    );
    if (!result.ok) {
      return result;
    }

    allChannels.push(
      ...result.data.channels.map((ch) => ({
        id: ch.id,
        name: ch.name,
        isPrivate: ch.is_private,
      })),
    );

    cursor = result.data.response_metadata?.next_cursor ?? '';
    if (cursor === '') {
      break;
    }
  }

  return { ok: true, channels: allChannels };
}

/**
 * Invite the bot to one channel. `already_in_channel` is reported as a
 * skip, not a failure; everything else surfaces its Slack error code.
 */
export function inviteBotToChannel(
  token: string,
  channelId: string,
  botUserId: string,
): { readonly outcome: InviteOutcome; readonly error?: string } {
  const result = slackApi<Record<string, never>>(
    token,
    'conversations.invite',
    { channel: channelId, users: botUserId },
    'post',
  );

  if (result.ok) {
    return { outcome: 'invited' };
  }
  if (result.error === 'already_in_channel') {
    return { outcome: 'already_in' };
  }
  return { outcome: 'failed', error: result.error };
}

/**
 * Exchange the OAuth callback code for the authorizing user's token
 * (`oauth.v2.access`, form-encoded, no Bearer header).
 */
export function exchangeOauthCode(args: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly redirectUri: string;
}):
  | { readonly ok: true; readonly userId: string; readonly accessToken: string }
  | { readonly ok: false; readonly error: string } {
  try {
    const response = UrlFetchApp.fetch(
      'https://slack.com/api/oauth.v2.access',
      {
        method: 'post',
        muteHttpExceptions: true,
        payload: {
          client_id: args.clientId,
          client_secret: args.clientSecret,
          code: args.code,
          redirect_uri: args.redirectUri,
        },
      },
    );
    const json = JSON.parse(response.getContentText()) as {
      ok: boolean;
      error?: string;
      authed_user?: { id?: string; access_token?: string };
    };
    if (!json.ok) {
      return { ok: false, error: json.error ?? 'unknown_error' };
    }
    const userId = json.authed_user?.id ?? '';
    const accessToken = json.authed_user?.access_token ?? '';
    if (userId === '' || accessToken === '') {
      return { ok: false, error: 'missing_authed_user' };
    }
    return { ok: true, userId, accessToken };
  } catch (error) {
    return { ok: false, error: `fetch_failed: ${String(error)}` };
  }
}

/**
 * Post an ephemeral follow-up to a slash command via its `response_url`.
 * The URL host is pinned to hooks.slack.com — a `response_url` comes from
 * an inbound request and must never turn this into an open proxy (SSRF).
 */
export function postToResponseUrl(responseUrl: string, text: string): boolean {
  if (!responseUrl.startsWith('https://hooks.slack.com/')) {
    Logger.log(`Refusing to post to non-Slack response_url: ${responseUrl}`);
    return false;
  }
  try {
    UrlFetchApp.fetch(responseUrl, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        response_type: 'ephemeral',
        replace_original: false,
        text,
      }),
    });
    return true;
  } catch (error) {
    Logger.log(`response_url post failed: ${String(error)}`);
    return false;
  }
}
