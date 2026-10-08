/**
 * GAS entry points. Functions here must not use the `export` keyword —
 * the GAS runtime does not support ES module syntax.
 *
 * Flow:
 *   /bot-inviter <alias>  → doPost  → (no token yet) OAuth prompt
 *                                   → (token stored) enqueue job + trigger
 *   OAuth redirect        → doGet   → exchange code, store user token
 *   one-off trigger       → processInviteJobs → invite + post summary
 */
import {
  MAX_RUNTIME_MS,
  SCRIPT_PROPERTY_KEYS,
  SLACK_USER_ID_PATTERN,
  USER_OAUTH_SCOPES,
} from './config.js';
import type { InviteJob, InviteResult } from './config.js';
import {
  buildAuthPrompt,
  buildEnqueuedMessage,
  buildInviteSummary,
  buildTargetErrorMessage,
  buildTokenInvalidMessage,
} from './messages.js';
import { buildAuthorizeUrl } from './oauth-url.js';
import {
  exchangeOauthCode,
  fetchMemberChannels,
  inviteBotToChannel,
  isAuthError,
  postToResponseUrl,
} from './slack-client.js';
import {
  clearJobTriggers,
  consumeOauthState,
  createOauthState,
  deleteUserToken,
  enqueueInviteJob,
  getOptionalScriptProperty,
  getRequiredScriptProperty,
  loadUserToken,
  saveUserToken,
  scheduleJobProcessing,
  takeAllInviteJobs,
} from './store.js';
import { setScriptProperties } from './setProperties.js';
import { parseTargetBots, resolveTarget } from './target-bots.js';

// Expose for `clasp run` (CI/CD property injection); not called at runtime.
(
  globalThis as { setScriptProperties?: typeof setScriptProperties }
).setScriptProperties = setScriptProperties;

interface WebAppEvent {
  readonly parameter?: Record<string, string | undefined>;
}

function ephemeralJson(text: string): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(
    JSON.stringify({ response_type: 'ephemeral', text }),
  ).setMimeType(ContentService.MimeType.JSON);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlPage(body: string): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutput(
    `<!doctype html><meta charset="utf-8"><title>bot-inviter</title>` +
      `<body style="font-family:sans-serif;max-width:40em;margin:4em auto">${body}</body>`,
  ).setTitle('bot-inviter');
}

function webAppUrl(): string {
  return ScriptApp.getService().getUrl();
}

function authorizeUrlFor(userId: string): string {
  return buildAuthorizeUrl({
    clientId: getRequiredScriptProperty(SCRIPT_PROPERTY_KEYS.clientId),
    redirectUri: webAppUrl(),
    state: createOauthState(userId),
    userScopes: USER_OAUTH_SCOPES,
  });
}

/** Slash-command endpoint. Must respond within 3 seconds. */
function doPost(e: WebAppEvent): GoogleAppsScript.Content.TextOutput {
  try {
    const params = e.parameter ?? {};

    if (params['ssl_check'] === '1') {
      return ContentService.createTextOutput('');
    }

    // GAS web apps hide request headers, so signing-secret verification is
    // impossible here; the (deprecated but still sent) verification token
    // is the strongest check available on this runtime.
    const expectedToken = getRequiredScriptProperty(
      SCRIPT_PROPERTY_KEYS.verificationToken,
    );
    if ((params['token'] ?? '') !== expectedToken) {
      return ContentService.createTextOutput('invalid verification token');
    }

    const userId = params['user_id'] ?? '';
    if (!SLACK_USER_ID_PATTERN.test(userId)) {
      return ContentService.createTextOutput('invalid user_id');
    }

    const responseUrl = params['response_url'] ?? '';
    if (!responseUrl.startsWith('https://hooks.slack.com/')) {
      return ContentService.createTextOutput('invalid response_url');
    }

    const bots = parseTargetBots(
      getRequiredScriptProperty(SCRIPT_PROPERTY_KEYS.targetBots),
    );
    const resolution = resolveTarget(params['text'] ?? '', bots);
    if (resolution.kind !== 'ok') {
      return ephemeralJson(buildTargetErrorMessage(resolution));
    }

    if (loadUserToken(userId) === null) {
      return ephemeralJson(buildAuthPrompt(authorizeUrlFor(userId)));
    }

    const job: InviteJob = {
      userId,
      botUserId: resolution.bot.botUserId,
      botAlias: resolution.bot.alias,
      responseUrl,
      enqueuedAt: new Date().toISOString(),
    };
    enqueueInviteJob(job);
    scheduleJobProcessing();
    return ephemeralJson(buildEnqueuedMessage(resolution.bot.alias));
  } catch (error) {
    Logger.log(`doPost failed: ${String(error)}`);
    return ephemeralJson(`:x: bot-inviter error: ${String(error)}`);
  }
}

/** OAuth redirect handler + landing page. */
function doGet(e: WebAppEvent): GoogleAppsScript.HTML.HtmlOutput {
  try {
    const params = e.parameter ?? {};

    if (params['error'] !== undefined) {
      return htmlPage(
        `<h1>Authorization failed</h1><p>Slack reported: <code>${escapeHtml(
          params['error'],
        )}</code>. Return to Slack and run <code>/bot-inviter</code> again.</p>`,
      );
    }

    const code = params['code'] ?? '';
    const state = params['state'] ?? '';
    if (code === '' || state === '') {
      return htmlPage(
        '<h1>bot-inviter</h1><p>This is the OAuth endpoint of a Slack app ' +
          'that bulk-invites bots to the channels you belong to. ' +
          'Run <code>/bot-inviter</code> in Slack to use it.</p>',
      );
    }

    const initiatingUserId = consumeOauthState(state);
    if (initiatingUserId === null) {
      return htmlPage(
        '<h1>Link expired</h1><p>This authorization link has expired or was ' +
          'already used. Run <code>/bot-inviter</code> in Slack to get a ' +
          'fresh one.</p>',
      );
    }

    const exchanged = exchangeOauthCode({
      clientId: getRequiredScriptProperty(SCRIPT_PROPERTY_KEYS.clientId),
      clientSecret: getRequiredScriptProperty(
        SCRIPT_PROPERTY_KEYS.clientSecret,
      ),
      code,
      redirectUri: webAppUrl(),
    });
    if (!exchanged.ok) {
      return htmlPage(
        `<h1>Authorization failed</h1><p>Token exchange failed: <code>${escapeHtml(
          exchanged.error,
        )}</code>. Run <code>/bot-inviter</code> in Slack and try again.</p>`,
      );
    }

    // The person who authorized must be the person who ran the command —
    // otherwise a forwarded/injected authorize link could bind someone
    // else's grant to a foreign session.
    if (exchanged.userId !== initiatingUserId) {
      return htmlPage(
        '<h1>User mismatch</h1><p>This link was issued to a different ' +
          'Slack user. Run <code>/bot-inviter</code> yourself to get your ' +
          'own authorization link.</p>',
      );
    }

    saveUserToken(exchanged.userId, exchanged.accessToken);

    return htmlPage(
      '<h1>Authorized ✔</h1><p>You can close this tab. Return to Slack and ' +
        'run <code>/bot-inviter</code> again to start inviting.</p>',
    );
  } catch (error) {
    Logger.log(`doGet failed: ${String(error)}`);
    return htmlPage(
      `<h1>Error</h1><p><code>${escapeHtml(String(error))}</code></p>`,
    );
  }
}

/** One-off trigger handler: drain the job queue and report per job. */
function processInviteJobs(): void {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    return;
  }
  try {
    clearJobTriggers();
    const startedAt = Date.now();
    for (const job of takeAllInviteJobs()) {
      processJob(job, startedAt);
    }
  } finally {
    lock.releaseLock();
  }
}

function processJob(job: InviteJob, startedAtMs: number): void {
  const token = loadUserToken(job.userId);
  if (token === null) {
    postToResponseUrl(
      job.responseUrl,
      buildAuthPrompt(authorizeUrlFor(job.userId)),
    );
    return;
  }

  const includePublic =
    getOptionalScriptProperty(SCRIPT_PROPERTY_KEYS.includePublicChannels) ===
    'true';

  const fetched = fetchMemberChannels(token, includePublic);
  if (!fetched.ok) {
    if (isAuthError(fetched.error)) {
      deleteUserToken(job.userId);
      postToResponseUrl(
        job.responseUrl,
        buildTokenInvalidMessage(authorizeUrlFor(job.userId)),
      );
    } else {
      postToResponseUrl(
        job.responseUrl,
        `:x: Failed to list your channels: \`${fetched.error}\``,
      );
    }
    return;
  }

  const results: InviteResult[] = [];
  let truncated = false;
  for (const channel of fetched.channels) {
    if (Date.now() - startedAtMs > MAX_RUNTIME_MS) {
      truncated = true;
      break;
    }
    const invite = inviteBotToChannel(token, channel.id, job.botUserId);
    results.push({
      channel,
      outcome: invite.outcome,
      ...(invite.error === undefined ? {} : { error: invite.error }),
    });
  }

  postToResponseUrl(
    job.responseUrl,
    buildInviteSummary(job.botAlias, results, { truncated }),
  );
}
