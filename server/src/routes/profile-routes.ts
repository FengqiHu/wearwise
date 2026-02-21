import { Router } from "express";
import { UserRepository } from "../repositories/user-repository.js";
import { AuthService } from "../services/auth-service.js";
import { parseProfileFromRequest } from "../services/profile-service.js";

interface ProfileRoutesDependencies {
  authService: AuthService;
  userRepository: UserRepository;
}

export function createProfileRoutes({ authService, userRepository }: ProfileRoutesDependencies): Router {
  const router = Router();

  router.get("/profile", async (req, res): Promise<void> => {
    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);

      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      res.json({ profile: authResolution.user.profile });
    } catch (error) {
      console.error("Get profile error:", error);
      res.status(500).json({ error: "Failed to read profile." });
    }
  });

  router.post("/profile", async (req, res): Promise<void> => {
    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);

      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const parsed = parseProfileFromRequest(req.body);

      if (!parsed.profile) {
        res.status(400).json({ error: parsed.error ?? "Invalid profile payload." });
        return;
      }

      const updatedUser = await userRepository.updateProfile(authResolution.user.id, parsed.profile);

      if (!updatedUser) {
        res.status(404).json({ error: "User not found." });
        return;
      }

      res.json({
        user: authService.toPublicUser(updatedUser),
        profile: updatedUser.profile,
        isFirstLogin: updatedUser.profile === null
      });
    } catch (error) {
      console.error("Save profile error:", error);
      res.status(500).json({ error: "Failed to save profile." });
    }
  });

  return router;
}
