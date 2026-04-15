import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { cn } from "../../lib/cn";
import { useAuth } from "../../context/auth-context";

const navItems = [
  { to: "/chat", label: "Chat" },
  { to: "/history", label: "History" },
  { to: "/wardrobe", label: "My Wardrobe" },
  { to: "/add", label: "Add Cloth" },
  { to: "/shop", label: "Shop New Item" }
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
  const avatarUrlKey = `${profile?.avatarUrl ?? ""}|${user?.picture ?? ""}`;
  const [avatarState, setAvatarState] = useState({ key: avatarUrlKey, index: 0 });
  const avatarIndex = avatarState.key === avatarUrlKey ? avatarState.index : 0;

  const avatarLabel = profile?.name?.trim().charAt(0).toUpperCase() || user?.name?.trim().charAt(0).toUpperCase() || "U";
  const avatarCandidates = [normalizeAvatarUrl(profile?.avatarUrl), normalizeAvatarUrl(user?.picture)].filter(
    (value): value is string => Boolean(value)
  );

  const avatarSrc = avatarCandidates[avatarIndex] ?? null;

  return (
    <header className="sticky top-0 z-30 border-b border-pebble bg-cream/90 backdrop-blur-xl">
      <div className="mx-auto grid h-14 w-full max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-4 px-4 md:px-8">
        {/* Logo */}
        <Link to="/" className="inline-flex items-center gap-2.5 text-charcoal">
          <div className="grid h-7 w-7 place-items-center rounded-full border border-pebble bg-[rgba(28,28,28,0.05)] text-[10px] font-semibold tracking-tight">
            WW
          </div>
          <span className="text-base font-semibold tracking-tight">WearWise</span>
        </Link>

        {/* Nav links */}
        <nav className="mx-auto flex items-center justify-center gap-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }: { isActive: boolean }) =>
                cn(
                  "rounded-md px-3 py-1.5 text-sm transition duration-150",
                  isAuthenticated
                    ? "text-charcoal hover:bg-[rgba(28,28,28,0.05)]"
                    : "pointer-events-none text-dim",
                  isActive && isAuthenticated && "bg-[rgba(28,28,28,0.07)] font-medium text-charcoal"
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Avatar */}
        <Link
          to={isAuthenticated ? "/profile" : "/"}
          className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-pebble bg-[rgba(28,28,28,0.04)] text-xs font-medium text-charcoal transition hover:bg-[rgba(28,28,28,0.08)]"
        >
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt="User avatar"
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.display = "none";
                setAvatarState((previous) => ({ key: avatarUrlKey, index: previous.index + 1 }));
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
