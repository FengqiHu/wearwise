import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ThinkingDots } from "../components/thinking-dots";
import { useAuth } from "../context/auth-context";
import { exchangeGoogleCode } from "../lib/api";
import { consumeOAuthState, consumePkceCodeVerifier, getGoogleRedirectUri } from "../lib/google-auth";

export function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { setSessionToken } = useAuth();
  const [statusText, setStatusText] = useState("Completing sign-in...");
  const [errorText, setErrorText] = useState<string | null>(null);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }

    hasStartedRef.current = true;

    const completeAuth = async (): Promise<void> => {
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      const tokenFromQuery = searchParams.get("token") ?? searchParams.get("access_token");
      const codeVerifier = consumePkceCodeVerifier();

      if (tokenFromQuery) {
        setSessionToken(tokenFromQuery);
        navigate("/chat", { replace: true });
        return;
      }

      if (!code) {
        setErrorText("OAuth callback is missing the authorization code.");
        return;
      }

      const stateIsValid = consumeOAuthState(state);
      if (!stateIsValid) {
        setErrorText("OAuth state validation failed. Please try signing in again.");
        return;
      }

      try {
        const response = await Promise.race([
          exchangeGoogleCode({
            code,
            redirectUri: getGoogleRedirectUri(),
            codeVerifier: codeVerifier ?? undefined
          }),
          new Promise<never>((_resolve, reject) => {
            window.setTimeout(() => reject(new Error("OAuth request timed out. Please try again.")), 15000);
          })
        ]);

        setSessionToken(response.accessToken);
        setStatusText("OAuth exchange complete. Redirecting...");
        navigate(response.isFirstLogin ? "/profile" : "/chat", { replace: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "OAuth sign-in failed.";
        setErrorText(message);
      }
    };

    void completeAuth();
  }, [navigate, setSessionToken]);

  return (
    <div className="mx-auto mt-20 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-4xl">Google Sign-in</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4 text-dim">
          {errorText ? (
            <div className="space-y-3">
              <p className="text-red-700">{errorText}</p>
              <Button onClick={() => navigate("/", { replace: true })}>Back to login</Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <ThinkingDots />
              <span>{statusText}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
