const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_STATE_KEY = "wearwise.oauth.state";
const OAUTH_PKCE_VERIFIER_KEY = "wearwise.oauth.pkce.verifier";

export function getGoogleRedirectUri(): string {
  const configuredRedirectUri = import.meta.env.VITE_GOOGLE_REDIRECT_URI?.trim();
  if (configuredRedirectUri) {
    return configuredRedirectUri;
  }

  return `${window.location.origin}/auth/callback`;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function createCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toBase64Url(new Uint8Array(digest));
}

function createAndStoreOAuthState(): string {
  const state = crypto.randomUUID();
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  return state;
}

export function consumeOAuthState(callbackState: string | null): boolean {
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);

  if (!expectedState || !callbackState) {
    return false;
  }

  return expectedState === callbackState;
}

export function consumePkceCodeVerifier(): string | null {
  const verifier = sessionStorage.getItem(OAUTH_PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(OAUTH_PKCE_VERIFIER_KEY);
  return verifier;
}

export async function getGoogleOAuthUrl(): Promise<string | null> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

  if (!clientId) {
    return null;
  }

  const redirectUri = getGoogleRedirectUri();
  const state = createAndStoreOAuthState();
  const codeVerifier = createCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  sessionStorage.setItem(OAUTH_PKCE_VERIFIER_KEY, codeVerifier);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}
