import { useState } from "react";
import { Navigate } from "react-router-dom";
import { HeroWardrobeAnimation } from "../components/hero-wardrobe-animation";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { ThinkingDots } from "../components/thinking-dots";
import { useAuth } from "../context/auth-context";
import { getGoogleOAuthUrl } from "../lib/google-auth";

export function WelcomePage() {
  const { isAuthenticated, isBootstrapping, profile } = useAuth();
  const [configError, setConfigError] = useState<string | null>(null);

  if (isAuthenticated && profile) {
    return <Navigate to="/chat" replace />;
  }

  if (isAuthenticated && !profile) {
    return <Navigate to="/profile" replace />;
  }

  if (isBootstrapping) {
    return (
      <div className="mx-auto mt-20 max-w-xl">
        <Card className="flex items-center gap-3 p-6 text-boutique-700">
          <ThinkingDots />
          <span>Checking your session...</span>
        </Card>
      </div>
    );
  }

  const handleGoogleLogin = async (): Promise<void> => {
    try {
      const oauthUrl = await getGoogleOAuthUrl();

      if (!oauthUrl) {
        setConfigError("Google OAuth is not configured in the frontend. Set VITE_GOOGLE_CLIENT_ID.");
        return;
      }

      setConfigError(null);
      window.location.assign(oauthUrl);
    } catch {
      setConfigError("Unable to prepare Google OAuth request in this browser.");
    }
  };

  return (
    <section className="relative isolate min-h-[560px] overflow-hidden rounded-[2.4rem] border border-boutique-200/80 shadow-soft">
      <HeroWardrobeAnimation />
      <div className="absolute inset-0 bg-gradient-to-r from-boutique-50/95 via-boutique-50/86 to-boutique-50/14" />

      <div className="relative z-20 flex min-h-[560px] items-center p-5 md:p-10 lg:p-12">
        <Card className="card-sheen w-full max-w-2xl border-boutique-200/90 bg-boutique-50/90 p-7 backdrop-blur-sm md:p-10">
          <CardHeader className="space-y-4">
            <p className="inline-flex w-fit rounded-full border border-boutique-300 bg-boutique-50/90 px-3 py-1 text-xs uppercase tracking-[0.16em] text-boutique-700">
              Personal cloud wardrobe
            </p>
            <CardTitle className="max-w-2xl text-4xl leading-tight md:text-6xl">
              Welcome to WearWise: Your Personal Clothing Agent
            </CardTitle>
            <CardDescription className="max-w-xl text-base leading-relaxed text-boutique-700">
              Upload your clothes, tell the AI your body profile and daily needs, and receive outfit suggestions with generated preview images.
            </CardDescription>
          </CardHeader>

          <CardContent className="mt-8 flex flex-col gap-3">
            <Button
              className="w-fit min-w-48"
              size="lg"
              onClick={() => {
                void handleGoogleLogin();
              }}
            >
              Continue with Google
            </Button>

            <p className="max-w-lg text-xs text-boutique-600">Google OAuth 2.0 will return to <code>/auth/callback</code> and create your WearWise session.</p>
            {configError ? <p className="max-w-lg text-sm text-red-700">{configError}</p> : null}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
