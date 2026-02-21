import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { cn } from "../../lib/cn";
import { useAuth } from "../../context/auth-context";

const navItems = [
  { to: "/chat", label: "Chat" },
  { to: "/wardrobe", label: "My Wardrobe" },
  { to: "/add", label: "Add Cloth" }
];

function normalizeAvatarUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) {
    return null;
  }

  const trimmed = rawUrl.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return null;
}

export function Navbar() {
  const { isAuthenticated, profile, user } = useAuth();
  const [avatarIndex, setAvatarIndex] = useState(0);

  const avatarLabel = profile?.name?.trim().charAt(0).toUpperCase() || user?.name?.trim().charAt(0).toUpperCase() || "U";
  const avatarCandidates = [normalizeAvatarUrl(profile?.avatarUrl), normalizeAvatarUrl(user?.picture)].filter(
    (value): value is string => Boolean(value)
  );
  const avatarSrc = avatarCandidates[avatarIndex] ?? null;

  useEffect(() => {
    setAvatarIndex(0);
  }, [profile?.avatarUrl, user?.picture]);

  return (
    <header className="sticky top-0 z-30 border-b border-boutique-200 bg-boutique-50/75 backdrop-blur-xl">
      <div className="mx-auto grid h-16 w-full max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-3 px-4 md:px-8">
        <Link to="/" className="inline-flex items-center gap-2 text-boutique-900">
          <div className="grid h-9 w-9 place-items-center rounded-full border border-boutique-300 bg-boutique-100 text-xs font-bold">
            WW
          </div>
          <span className="font-display text-2xl font-semibold tracking-wide">WearWise</span>
        </Link>

        <nav className="mx-auto flex items-center justify-center gap-2 rounded-full border border-boutique-200 bg-boutique-50/80 px-2 py-1 shadow-insetWarm">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }: { isActive: boolean }) =>
                cn(
                  "rounded-full px-4 py-2 text-sm font-medium transition",
                  isAuthenticated ? "text-boutique-700 hover:bg-boutique-100" : "text-boutique-500",
                  isActive && isAuthenticated && "bg-boutique-200 text-boutique-900"
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <Link
          to={isAuthenticated ? "/profile" : "/"}
          className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-boutique-300 bg-boutique-100 text-sm font-semibold text-boutique-800"
        >
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt="User avatar"
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.display = "none";
                setAvatarIndex((previous) => previous + 1);
              }}
            />
          ) : (
            avatarLabel
          )}
        </Link>
      </div>
    </header>
  );
}
