/**
 * GAS-side storage: Script Properties (config + user tokens + job queue),
 * CacheService (OAuth state nonces) and trigger management.
 * Excluded from unit coverage — GAS globals cannot run in Node.js.
 */
import {
  JOB_PREFIX,
  OAUTH_STATE_TTL_SECONDS,
  USER_TOKEN_PREFIX,
} from './config.js';
import type { InviteJob } from './config.js';

export function getRequiredScriptProperty(key: string): string {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (value === null || value.trim() === '') {
    throw new Error(`${key} is not set in Script Properties`);
  }
  return value.trim();
}

export function getOptionalScriptProperty(key: string): string | null {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return value === null || value.trim() === '' ? null : value.trim();
}

export function saveUserToken(userId: string, token: string): void {
  PropertiesService.getScriptProperties().setProperty(
    USER_TOKEN_PREFIX + userId,
    token,
  );
}

export function loadUserToken(userId: string): string | null {
  return PropertiesService.getScriptProperties().getProperty(
    USER_TOKEN_PREFIX + userId,
  );
}

export function deleteUserToken(userId: string): void {
  PropertiesService.getScriptProperties().deleteProperty(
    USER_TOKEN_PREFIX + userId,
  );
}

/**
 * Create a single-use OAuth `state` nonce bound to the Slack user who
 * initiated the flow. The nonce proves the callback was started from our
 * slash command (CSRF protection) and expires after 10 minutes.
 */
export function createOauthState(userId: string): string {
  const nonce = Utilities.getUuid();
  CacheService.getScriptCache()!.put(nonce, userId, OAUTH_STATE_TTL_SECONDS);
  return nonce;
}

/** Return the bound user ID and invalidate the nonce (single use). */
export function consumeOauthState(state: string): string | null {
  const cache = CacheService.getScriptCache()!;
  const userId = cache.get(state);
  if (userId !== null) {
    cache.remove(state);
  }
  return userId;
}

export function enqueueInviteJob(job: InviteJob): void {
  PropertiesService.getScriptProperties().setProperty(
    JOB_PREFIX + Utilities.getUuid(),
    JSON.stringify(job),
  );
}

/**
 * Pop every pending job. Jobs are deleted up front so a crash cannot make
 * the same invite storm run twice; the user simply re-runs the command.
 */
export function takeAllInviteJobs(): readonly InviteJob[] {
  const props = PropertiesService.getScriptProperties();
  const keys = props.getKeys().filter((key) => key.startsWith(JOB_PREFIX));

  const jobs = keys.flatMap((key): InviteJob[] => {
    const raw = props.getProperty(key);
    props.deleteProperty(key);
    if (raw === null) {
      return [];
    }
    try {
      return [JSON.parse(raw) as InviteJob];
    } catch (error) {
      Logger.log(`Dropping unparsable job ${key}: ${String(error)}`);
      return [];
    }
  });

  return jobs;
}

/** Fire `processInviteJobs` shortly after the slash command returns. */
export function scheduleJobProcessing(): void {
  ScriptApp.newTrigger('processInviteJobs').timeBased().after(1000).create();
}

/** Remove fired/stale one-off triggers so the project stays under quota. */
export function clearJobTriggers(): void {
  const triggers = ScriptApp.getProjectTriggers().filter(
    (trigger) => trigger.getHandlerFunction() === 'processInviteJobs',
  );
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }
}
