import { Router } from "express";
import { UserRepository } from "../repositories/user-repository.js";
import { AuthService } from "../services/auth-service.js";
import { GoogleOAuthService } from "../services/google-oauth-service.js";
import { SessionService } from "../services/session-service.js";

interface AuthRoutesDependencies {
  authService: AuthService;
  googleOAuthService: GoogleOAuthService;
  sessionService: SessionService;
  sessionTtlSeconds: number;
  userRepository: UserRepository;
}

export function createAuthRoutes({
  authService,
  googleOAuthService,
  sessionService,
  sessionTtlSeconds,
  userRepository
}: AuthRoutesDependencies): Router {
  const router = Router();

  router.post("/auth/google/exchange", async (req, res): Promise<void> => {
    try {
      console.log("[oauth] /api/auth/google/exchange request received");

      const body = req.body as { code?: unknown; redirectUri?: unknown; codeVerifier?: unknown };
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const redirectUri = typeof body.redirectUri === "string" ? body.redirectUri.trim() : "";
      const codeVerifier = typeof body.codeVerifier === "string" ? body.codeVerifier.trim() : "";

      const exchangeResult = await googleOAuthService.exchangeCodeForIdentity({
        code,
        redirectUri,
        codeVerifier
      });

      if (!exchangeResult.ok) {
        res.status(exchangeResult.status).json({
          error: exchangeResult.error,
          providerError: exchangeResult.providerError ?? null,
          providerDescription: exchangeResult.providerDescription ?? null
        });
        return;
      }

      // get userinfo, and store token
      const user = await userRepository.upsertFromGoogleIdentity(exchangeResult.identity);
      const accessToken = sessionService.createSessionToken(user.id);

      // return user info and token, incluidng expire time
      res.json({
        accessToken,
        tokenType: "Bearer",
        expiresIn: sessionTtlSeconds,
        // store user info in the session cookie, so client can read it on page load without an extra request
        user: authService.toPublicUser(user),
        profile: user.profile,
        isFirstLogin: user.profile === null
      });
    } catch (error) {
      console.error("OAuth exchange error:", error);
      res.status(500).json({ error: "OAuth exchange failed unexpectedly." });
    }
  });

  // check current authentication status and get user info (verify the session token in cookie)
  router.get("/auth/me", async (req, res): Promise<void> => {
    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);

      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      res.json({
        user: authService.toPublicUser(authResolution.user),
        profile: authResolution.user.profile,
        isFirstLogin: authResolution.user.profile === null
      });
    } catch (error) {
      console.error("Auth me error:", error);
      res.status(500).json({ error: "Failed to read session." });
    }
  });

  return router;
}
