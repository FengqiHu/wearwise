import { Router } from "express";
import { UserRepository } from "../repositories/user-repository.js";
import { AuthService } from "../services/auth-service.js";
import { parseProfileFromRequest } from "../services/profile-service.js";
import type { R2StorageService } from "../services/r2-storage-service.js";
import type { UserProfile } from "../types/domain.js";

interface ProfileRoutesDependencies {
  authService: AuthService;
  userRepository: UserRepository;
  r2StorageService: R2StorageService;
}

const PROFILE_IMAGE_FIELDS = ["avatarUrl", "headshotImageUrl", "fullBodyImageUrl"] as const;

function findObsoleteManagedProfileImages(
  previousProfile: UserProfile | null,
  nextProfile: UserProfile,
  r2StorageService: R2StorageService
): string[] {
  if (!previousProfile) {
    return [];
  }

  const nextUrls = new Set(
    PROFILE_IMAGE_FIELDS
      .map((field) => nextProfile[field])
      .filter((url): url is string => Boolean(url))
  );
  const obsoleteUrls = new Set<string>();

  for (const field of PROFILE_IMAGE_FIELDS) {
    const previousUrl = previousProfile[field];
    if (!previousUrl || nextUrls.has(previousUrl) || !r2StorageService.ownsPublicUrl(previousUrl)) {
      continue;
    }

    obsoleteUrls.add(previousUrl);
  }

  return [...obsoleteUrls];
}

export function createProfileRoutes({ authService, userRepository, r2StorageService }: ProfileRoutesDependencies): Router {
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

      if (r2StorageService.isConfigured()) {
        const obsoleteImageUrls = findObsoleteManagedProfileImages(
          authResolution.user.profile,
          parsed.profile,
          r2StorageService
        );

        await Promise.all(
          obsoleteImageUrls.map(async (imageUrl) => {
            try {
              await r2StorageService.deleteObject(imageUrl);
            } catch (cleanupError) {
              console.error(`Failed to delete obsolete profile image: ${imageUrl}`, cleanupError);
            }
          })
        );
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
