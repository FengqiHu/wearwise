import { Outlet, useLocation } from "react-router-dom";
import { cn } from "../../lib/cn";
import { Navbar } from "./navbar";

export function AppShell() {
  const location = useLocation();
  const isChatRoute = location.pathname.startsWith("/chat");

  return (
    <div className={cn("relative overflow-hidden bg-cream", isChatRoute ? "h-screen" : "min-h-screen")}>
      <div className="pointer-events-none fixed inset-0 opacity-50">
        <div className="absolute -left-28 top-14 h-80 w-80 rounded-full bg-orange-100/50 blur-3xl" />
        <div className="absolute -right-24 bottom-20 h-96 w-96 rounded-full bg-pink-100/30 blur-3xl" />
        <div className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-blue-50/20 blur-3xl" />
      </div>

      <div className={cn("relative z-10", isChatRoute ? "flex h-full flex-col" : "")}>
        <Navbar />
        <main
          className={cn(
            isChatRoute
              ? "flex flex-1 overflow-hidden"
              : "mx-auto w-full max-w-6xl px-4 pb-10 pt-6 md:px-8"
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
