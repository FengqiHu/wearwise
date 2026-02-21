import type { UserProfile } from "../types/domain.js";

interface ParseProfileResult {
  profile?: UserProfile;
  error?: string;
}

export function parseProfileFromRequest(input: unknown): ParseProfileResult {
  if (!input || typeof input !== "object") {
    return { error: "Invalid profile payload." };
  }

  const payload = input as Record<string, unknown>;
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const styleNote = typeof payload.styleNote === "string" ? payload.styleNote.trim() : "";
  const avatarUrlRaw = payload.avatarUrl;
  const avatarUrl = typeof avatarUrlRaw === "string" && avatarUrlRaw.trim().length > 0 ? avatarUrlRaw.trim() : null;
  const heightCm =
    typeof payload.heightCm === "number"
      ? payload.heightCm
      : typeof payload.heightCm === "string"
        ? Number.parseFloat(payload.heightCm)
        : Number.NaN;
  const weightKg =
    typeof payload.weightKg === "number"
      ? payload.weightKg
      : typeof payload.weightKg === "string"
        ? Number.parseFloat(payload.weightKg)
        : Number.NaN;

  if (!name) {
    return { error: "Name is required." };
  }

  if (!Number.isFinite(heightCm) || heightCm <= 0) {
    return { error: "Height must be a positive number." };
  }

  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return { error: "Weight must be a positive number." };
  }

  return {
    profile: {
      name,
      heightCm,
      weightKg,
      styleNote,
      avatarUrl
    }
  };
}
