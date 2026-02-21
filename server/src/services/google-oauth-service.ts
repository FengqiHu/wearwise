import { fetchWithTimeout } from "../lib/http.js";
import type { GoogleIdentity, GoogleTokenResponse } from "../types/domain.js";

interface GoogleOAuthServiceConfig {
  clientId: string;
  clientSecret: string;
  defaultRedirectUri: string;
}

interface ExchangeCodeInput {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

interface GoogleExchangeSuccess {
  ok: true;
  identity: GoogleIdentity;
}

interface GoogleExchangeFailure {
  ok: false;
  status: number;
  error: string;
  providerError?: string | null;
  providerDescription?: string | null;
}

export type GoogleExchangeResult = GoogleExchangeSuccess | GoogleExchangeFailure;

function getNameFromEmail(email: string): string {
  const firstSegment = email.split("@")[0];
  return firstSegment || email;
}

function mergeGoogleIdentity(
  identityFromIdToken: GoogleIdentity | null,
  identityFromUserInfo: GoogleIdentity | null
): GoogleIdentity | null {
  if (!identityFromIdToken && !identityFromUserInfo) {
    return null;
  }

  const base = identityFromUserInfo ?? identityFromIdToken;
  const fallback = identityFromIdToken ?? identityFromUserInfo;

  if (!base || !fallback) {
    return base;
  }

  const mergedEmail = base.email || fallback.email;
  const mergedSub = base.sub || fallback.sub;

  if (!mergedSub || !mergedEmail) {
    return null;
  }

  return {
    sub: mergedSub,
    email: mergedEmail,
    name: base.name || fallback.name || getNameFromEmail(mergedEmail),
    picture: base.picture || fallback.picture || null,
    emailVerified: base.emailVerified ?? fallback.emailVerified ?? null
  };
}

export class GoogleOAuthService {
  constructor(private readonly config: GoogleOAuthServiceConfig) {}

  async exchangeCodeForIdentity(input: ExchangeCodeInput): Promise<GoogleExchangeResult> {
    if (!this.config.clientId) {
      return {
        ok: false,
        status: 500,
        error: "Google OAuth is not configured on server. Set GOOGLE_CLIENT_ID."
      };
    }

    const redirectUri = input.redirectUri || this.config.defaultRedirectUri;

    if (!input.code || !redirectUri) {
      return {
        ok: false,
        status: 400,
        error: "Both code and redirectUri are required."
      };
    }

    const tokenPayload = new URLSearchParams({
      code: input.code,
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    });

    if (this.config.clientSecret) {
      tokenPayload.set("client_secret", this.config.clientSecret);
    }

    if (input.codeVerifier) {
      tokenPayload.set("code_verifier", input.codeVerifier);
    }

    let tokenResponse: globalThis.Response;

    try {
      tokenResponse = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
        timeoutMs: 10000,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: tokenPayload.toString()
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          ok: false,
          status: 504,
          error: "OAuth request to Google timed out from server. Check server network/proxy settings."
        };
      }

      return {
        ok: false,
        status: 502,
        error: "Server could not reach Google OAuth endpoint."
      };
    }

    const tokenData = (await tokenResponse.json()) as GoogleTokenResponse;

    if (!tokenResponse.ok || (!tokenData.access_token && !tokenData.id_token)) {
      return {
        ok: false,
        status: 401,
        error: "Google OAuth code exchange failed.",
        providerError: tokenData.error ?? null,
        providerDescription: tokenData.error_description ?? null
      };
    }

    const identityFromIdToken = tokenData.id_token ? this.parseGoogleIdentityFromIdToken(tokenData.id_token) : null;
    const identityFromUserInfo = tokenData.access_token ? await this.fetchGoogleIdentity(tokenData.access_token) : null;
    const identity = mergeGoogleIdentity(identityFromIdToken, identityFromUserInfo);

    if (!identity) {
      return {
        ok: false,
        status: 401,
        error: "Could not determine Google account identity."
      };
    }

    if (identity.emailVerified === false) {
      return {
        ok: false,
        status: 403,
        error: "Google account email is not verified."
      };
    }

    return {
      ok: true,
      identity
    };
  }

  private parseGoogleIdentityFromIdToken(idToken: string): GoogleIdentity | null {
    const parts = idToken.split(".");

    if (parts.length < 2) {
      return null;
    }

    try {
      const payloadSegment = parts[1];
      if (!payloadSegment) {
        return null;
      }

      const payloadRaw = Buffer.from(payloadSegment, "base64url").toString("utf8");
      const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
      const aud = payload.aud;
      const expiration = payload.exp;
      const expectedAudience = this.config.clientId;

      if (typeof expectedAudience !== "string" || expectedAudience.length === 0) {
        return null;
      }

      if (typeof aud === "string" && aud !== expectedAudience) {
        return null;
      }

      if (Array.isArray(aud) && !aud.includes(expectedAudience)) {
        return null;
      }

      if (typeof expiration === "number" && expiration <= Math.floor(Date.now() / 1000)) {
        return null;
      }

      const sub = typeof payload.sub === "string" ? payload.sub : "";
      const email = typeof payload.email === "string" ? payload.email : "";

      if (!sub || !email) {
        return null;
      }

      const name = typeof payload.name === "string" ? payload.name : getNameFromEmail(email);
      const picture = typeof payload.picture === "string" ? payload.picture : null;
      const emailVerifiedRaw = payload.email_verified;
      const emailVerified =
        typeof emailVerifiedRaw === "boolean"
          ? emailVerifiedRaw
          : typeof emailVerifiedRaw === "string"
            ? emailVerifiedRaw.toLowerCase() === "true"
            : null;

      return {
        sub,
        email,
        name,
        picture,
        emailVerified
      };
    } catch {
      return null;
    }
  }

  private async fetchGoogleIdentity(accessToken: string): Promise<GoogleIdentity | null> {
    try {
      const response = await fetchWithTimeout("https://openidconnect.googleapis.com/v1/userinfo", {
        timeoutMs: 10000,
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const sub = typeof payload.sub === "string" ? payload.sub : "";
      const email = typeof payload.email === "string" ? payload.email : "";

      if (!sub || !email) {
        return null;
      }

      const name = typeof payload.name === "string" ? payload.name : getNameFromEmail(email);
      const picture = typeof payload.picture === "string" ? payload.picture : null;
      const emailVerifiedRaw = payload.email_verified;
      const emailVerified =
        typeof emailVerifiedRaw === "boolean"
          ? emailVerifiedRaw
          : typeof emailVerifiedRaw === "string"
            ? emailVerifiedRaw.toLowerCase() === "true"
            : null;

      return {
        sub,
        email,
        name,
        picture,
        emailVerified
      };
    } catch {
      return null;
    }
  }
}
