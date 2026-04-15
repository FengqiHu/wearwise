import { useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/app-shell";
import { Card } from "./components/ui/card";
import { ThinkingDots } from "./components/thinking-dots";
import { useAuth } from "./context/auth-context";
import { seedWardrobeIfEmpty } from "./lib/storage";
import { AddPage } from "./pages/add-page";
import { ChatPage } from "./pages/chat-page";
import { ClothDetailPage } from "./pages/cloth-detail-page";
import { HistoryPage } from "./pages/history-page";
import { NotFoundPage } from "./pages/not-found-page";
import { OAuthCallbackPage } from "./pages/oauth-callback-page";
import { ProfilePage } from "./pages/profile-page";
import { ShopPage } from "./pages/shop-page";
import { WardrobePage } from "./pages/wardrobe-page";
import { WelcomePage } from "./pages/welcome-page";

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isBootstrapping } = useAuth();

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

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function RequireOnboarded({ children }: { children: ReactNode }) {
  const { isAuthenticated, isBootstrapping, profile } = useAuth();

  if (isBootstrapping) {
    return (
      <div className="mx-auto mt-20 max-w-xl">
        <Card className="flex items-center gap-3 p-6 text-boutique-700">
          <ThinkingDots />
          <span>Loading your wardrobe profile...</span>
        </Card>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (!profile) {
    return <Navigate to="/profile" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  useEffect(() => {
    seedWardrobeIfEmpty();
  }, []);

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/auth/callback" element={<OAuthCallbackPage />} />

        <Route
          path="/profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />

        <Route
          path="/chat"
          element={
            <RequireOnboarded>
              <ChatPage />
            </RequireOnboarded>
          }
        />

        <Route
          path="/add"
          element={
            <RequireOnboarded>
              <AddPage />
            </RequireOnboarded>
          }
        />

        <Route
          path="/history"
          element={
            <RequireOnboarded>
              <HistoryPage />
            </RequireOnboarded>
          }
        />

        <Route
          path="/wardrobe"
          element={
            <RequireOnboarded>
              <WardrobePage />
            </RequireOnboarded>
          }
        />

        <Route
          path="/cloth/:id"
          element={
            <RequireOnboarded>
              <ClothDetailPage />
            </RequireOnboarded>
          }
        />

        <Route
          path="/shop"
          element={
            <RequireOnboarded>
              <ShopPage />
            </RequireOnboarded>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
