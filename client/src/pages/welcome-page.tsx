import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { ThinkingDots } from "../components/thinking-dots";
import { useAuth } from "../context/auth-context";
import { getGoogleOAuthUrl } from "../lib/google-auth";
import { consumeAccountDeletedNotice } from "../lib/storage";

function WardrobeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

const features = [
  {
    icon: <WardrobeIcon />,
    title: "Smart Wardrobe",
    description:
      "Photograph and upload every item you own. Our AI tags, categorizes, and organizes your entire wardrobe in the cloud — accessible anywhere, anytime."
  },
  {
    icon: <SparkleIcon />,
    title: "AI Recommendations",
    description:
      "Tell us the weather, the occasion, or your mood. WearWise curates complete outfits from your wardrobe that match your needs and personal style."
  },
  {
    icon: <EyeIcon />,
    title: "Virtual Preview",
    description:
      "See AI-generated images of recommended outfits styled to your body profile before you commit to a look. No more standing in front of the mirror guessing."
  }
];

const steps = [
  {
    number: "01",
    title: "Build your wardrobe",
    description:
      "Take photos of your clothing and upload them to WearWise. Add details like color, occasion, and season for smarter, more personalized recommendations."
  },
  {
    number: "02",
    title: "Create your style profile",
    description:
      "Share your body measurements, style preferences, and typical lifestyle. The more we know, the better your outfit recommendations become over time."
  },
  {
    number: "03",
    title: "Ask for outfit ideas",
    description:
      "Chat with our AI stylist. Tell it where you're going, the weather, or the vibe you're after — and get tailored outfit suggestions instantly."
  }
];

export function WelcomePage() {
  const { isAuthenticated, isBootstrapping, profile } = useAuth();
  const [configError, setConfigError] = useState<string | null>(null);
  const [accountDeletedNotice, setAccountDeletedNotice] = useState(false);

  useEffect(() => {
    setAccountDeletedNotice(consumeAccountDeletedNotice());
  }, []);

  if (isBootstrapping) {
    return (
      <div className="mx-auto mt-20 max-w-sm">
        <div className="flex items-center gap-3 rounded-xl border border-pebble bg-cream p-5 text-charcoal">
          <ThinkingDots />
          <span className="text-sm">Checking your session...</span>
        </div>
      </div>
    );
  }

  if (isAuthenticated && profile) {
    return <Navigate to="/chat" replace />;
  }

  if (isAuthenticated && !profile) {
    return <Navigate to="/profile" replace />;
  }

  const handleGoogleLogin = async (): Promise<void> => {
    try {
      const oauthUrl = await getGoogleOAuthUrl();

      if (!oauthUrl) {
        setConfigError("Google OAuth is not configured. Set VITE_GOOGLE_CLIENT_ID.");
        return;
      }

      setConfigError(null);
      window.location.assign(oauthUrl);
    } catch {
      setConfigError("Unable to prepare Google OAuth request in this browser.");
    }
  };

  return (
    <div>
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24 text-center md:py-32">
        {/* Atmospheric gradient wash */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-0 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-orange-100/50 blur-3xl" />
          <div className="absolute -right-16 top-20 h-64 w-64 rounded-full bg-pink-100/35 blur-3xl" />
          <div className="absolute -left-16 top-28 h-64 w-64 rounded-full bg-sky-100/25 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-3xl px-4">
        <div className="mb-6 inline-flex items-center rounded-full border border-pebble px-3 py-1 text-xs uppercase tracking-[0.14em] text-dim">
            AI-Powered Personal Styling
          </div>

          {accountDeletedNotice ? (
            <div className="mx-auto mb-6 max-w-2xl rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Your WearWise account and WearWise-managed data were permanently deleted. Your Google account was not changed.
            </div>
          ) : null}

          <h1 className="mb-5 text-5xl font-semibold leading-tight tracking-tight text-charcoal md:text-[3.75rem]">
            Your personal cloud<br />wardrobe, reimagined.
          </h1>

          <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-dim">
            Upload your clothing collection, share your style preferences, and receive AI-curated outfit
            recommendations — with generated preview images showing how each look will appear on you.
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              variant="primary"
              onClick={() => {
                void handleGoogleLogin();
              }}
            >
              Continue with Google
            </Button>
            <Button size="lg" variant="outline">
              Explore features
            </Button>
          </div>

          {configError ? <p className="mt-4 text-sm text-red-700">{configError}</p> : null}

          <p className="mt-5 text-xs text-dim">
            Secure sign-in via Google OAuth 2.0 · Returns to{" "}
            <code className="rounded bg-[rgba(28,28,28,0.06)] px-1 py-0.5 font-mono text-[11px]">/auth/callback</code>
          </p>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────── */}
      <section className="py-20 md:py-24" id="features">
        <div className="mx-auto max-w-2xl px-4 text-center">
          <h2 className="mb-4 text-4xl font-semibold tracking-tight text-charcoal">
            Everything you need to dress well
          </h2>
          <p className="text-base leading-relaxed text-dim">
            WearWise combines wardrobe management, AI styling, and virtual try-on into one seamless experience.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-4 px-4 md:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-pebble bg-cream p-7">
              <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-pebble text-charcoal">
                {feature.icon}
              </div>
              <h3 className="mb-2 text-xl font-medium text-charcoal">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-dim">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Divider ────────────────────────────────────────────── */}
      <div className="mx-auto max-w-5xl px-4">
        <div className="border-t border-pebble" />
      </div>

      {/* ── How It Works ───────────────────────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="mx-auto max-w-2xl px-4 text-center">
          <h2 className="mb-4 text-4xl font-semibold tracking-tight text-charcoal">
            Getting dressed, effortlessly
          </h2>
          <p className="text-base leading-relaxed text-dim">
            Three simple steps to your best outfits, every single day.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-4xl grid-cols-1 gap-10 px-4 md:grid-cols-3">
          {steps.map((step) => (
            <div key={step.number} className="flex flex-col">
              <span className="mb-4 block text-4xl font-semibold text-[rgba(28,28,28,0.1)]">{step.number}</span>
              <h3 className="mb-2 text-lg font-medium text-charcoal">{step.title}</h3>
              <p className="text-sm leading-relaxed text-dim">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Divider ────────────────────────────────────────────── */}
      <div className="mx-auto max-w-5xl px-4">
        <div className="border-t border-pebble" />
      </div>

      {/* ── Bottom CTA ─────────────────────────────────────────── */}
      <section className="py-20 text-center md:py-24">
        <div className="mx-auto max-w-xl px-4">
          <h2 className="mb-4 text-4xl font-semibold tracking-tight text-charcoal">Ready to dress smarter?</h2>
          <p className="mb-8 text-base leading-relaxed text-dim">
            Join WearWise and let AI take the guesswork out of getting dressed. Your perfect outfit is just a
            conversation away.
          </p>
          <Button
            size="lg"
            variant="primary"
            onClick={() => {
              void handleGoogleLogin();
            }}
          >
            Get started with Google
          </Button>
          {configError ? <p className="mt-4 text-sm text-red-700">{configError}</p> : null}
        </div>
      </section>
    </div>
  );
}
