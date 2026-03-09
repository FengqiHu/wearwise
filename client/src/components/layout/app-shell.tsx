import { Outlet, useLocation } from "react-router-dom";
import { cn } from "../../lib/cn";
import { Navbar } from "./navbar";

export function AppShell() {
  const location = useLocation();
  const isChatRoute = location.pathname.startsWith("/chat");

  return (
    <div className="relative min-h-screen overflow-hidden bg-boutique-atmosphere">
      <div className="pointer-events-none fixed inset-0 opacity-60">
        <div className="absolute -left-28 top-14 h-72 w-72 rounded-full bg-boutique-200/35 blur-3xl" />
        <div className="absolute -right-24 bottom-20 h-96 w-96 rounded-full bg-boutique-300/35 blur-3xl" />
      </div>

      <div className="relative z-10">
        <Navbar />
        <main
          className={cn(
            "mx-auto w-full px-4 pb-10 pt-6 md:px-8",
            isChatRoute ? "max-w-[96rem]" : "max-w-6xl"
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
