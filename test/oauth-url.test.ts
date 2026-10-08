import { buildAuthorizeUrl } from '../src/oauth-url.js';

// The GAS tsconfig has no DOM/Node lib, so parse the query without `URL`.
const queryOf = (url: string): Record<string, string> => {
  const query = url.split('?')[1] ?? '';
  return Object.fromEntries(
    query.split('&').map((pair) => {
      const [key = '', value = ''] = pair.split('=');
      return [decodeURIComponent(key), decodeURIComponent(value)];
    }),
  );
};

describe('buildAuthorizeUrl', () => {
  const args = {
    clientId: '123.456',
    redirectUri: 'https://script.google.com/macros/s/XXX/exec',
    state: 'nonce-1',
    userScopes: ['channels:read', 'groups:read'],
  };

  it('points at the Slack OAuth v2 authorize endpoint', () => {
    expect(buildAuthorizeUrl(args)).toMatch(
      /^https:\/\/slack\.com\/oauth\/v2\/authorize\?/,
    );
  });

  it('requests user scopes only (empty bot scope)', () => {
    const params = queryOf(buildAuthorizeUrl(args));
    expect(params['scope']).toBe('');
    expect(params['user_scope']).toBe('channels:read,groups:read');
  });

  it('carries client_id, redirect_uri and state, URL-encoded', () => {
    const url = buildAuthorizeUrl(args);
    expect(url).toContain(
      'redirect_uri=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2FXXX%2Fexec',
    );
    const params = queryOf(url);
    expect(params['client_id']).toBe('123.456');
    expect(params['redirect_uri']).toBe(args.redirectUri);
    expect(params['state']).toBe('nonce-1');
  });
});
