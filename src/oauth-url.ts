/**
 * Build the Slack OAuth v2 authorize URL for the user-token flow.
 * `scope` (bot) is deliberately empty — this app only needs user scopes
 * to act as the person running the command.
 */
export function buildAuthorizeUrl(args: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly userScopes: readonly string[];
}): string {
  const params = [
    ['client_id', args.clientId],
    ['scope', ''],
    ['user_scope', args.userScopes.join(',')],
    ['redirect_uri', args.redirectUri],
    ['state', args.state],
  ] as const;

  const query = params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

  return `https://slack.com/oauth/v2/authorize?${query}`;
}
