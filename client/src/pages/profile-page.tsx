import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { useAuth } from "../context/auth-context";
import { uploadManagedImage } from "../lib/api";
import type { UserProfile } from "../types";

const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024;
const DEFAULT_FULL_BODY_IMAGE = "/profile-defaults/full-body-default.svg";
const DEFAULT_HEADSHOT_IMAGE = "/profile-defaults/headshot-default.svg";

type UploadField = "avatarUrl" | "fullBodyImageUrl" | "headshotImageUrl";

function toPositiveNumber(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
}

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

export function ProfilePage() {
  const navigate = useNavigate();
  const { token, profile, user, saveProfile, logout } = useAuth();
  const isEditingProfile = Boolean(profile);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const fullBodyInputRef = useRef<HTMLInputElement | null>(null);
  const headshotInputRef = useRef<HTMLInputElement | null>(null);

  const initialForm = useMemo(
    () => ({
      name: profile?.name ?? "",
      heightCm: profile ? String(profile.heightCm) : "",
      weightKg: profile ? String(profile.weightKg) : "",
      styleNote: profile?.styleNote ?? "",
      avatarUrl: profile?.avatarUrl ?? "",
      fullBodyImageUrl: profile?.fullBodyImageUrl ?? "",
      headshotImageUrl: profile?.headshotImageUrl ?? "",
      sex: profile?.sex ?? ""
    }),
    [profile]
  );

  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState<UploadField | null>(null);

  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);

  const updateField = (field: keyof typeof form, value: string): void => {
    setForm((previous) => ({
      ...previous,
      [field]: value
    }));
  };

  const handleImageUpload = async (field: UploadField, event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const [file] = Array.from(event.target.files ?? []);

    if (!file) {
      event.target.value = "";
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_IMAGE_FILE_SIZE) {
      setError("Image size must be 5MB or less.");
      event.target.value = "";
      return;
    }

    if (!token) {
      setError("You need to sign in again before uploading images.");
      event.target.value = "";
      return;
    }

    try {
      setUploadingField(field);
      const folder = field === "avatarUrl" ? "avatar" : field === "headshotImageUrl" ? "headshot" : "full-body";
      const uploaded = await uploadManagedImage(token, {
        folder,
        file
      });

      setError(null);
      updateField(field, uploaded.publicUrl);
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Failed to upload image.";
      setError(message);
    } finally {
      setUploadingField(null);
      event.target.value = "";
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    const heightCm = toPositiveNumber(form.heightCm);
    const weightKg = toPositiveNumber(form.weightKg);

    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }

    if (Number.isNaN(heightCm) || Number.isNaN(weightKg)) {
      setError("Height and weight must be valid positive numbers.");
      return;
    }

    const trimmedAvatarUrl = form.avatarUrl.trim();
    const trimmedFullBodyImageUrl = form.fullBodyImageUrl.trim();
    const trimmedHeadshotImageUrl = form.headshotImageUrl.trim();

    if (!trimmedFullBodyImageUrl) {
      setError("Full-body is required.");
      return;
    }

    const nextProfile: UserProfile = {
      name: form.name.trim(),
      heightCm,
      weightKg,
      styleNote: form.styleNote.trim(),
      avatarUrl: trimmedAvatarUrl || undefined,
      fullBodyImageUrl: trimmedFullBodyImageUrl || undefined,
      headshotImageUrl: trimmedHeadshotImageUrl || undefined,
      ...(form.sex && { sex: form.sex as "male" | "female" | "other" })
    };

    setIsSaving(true);

    try {
      await saveProfile(nextProfile);
      navigate("/chat");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Failed to save profile.";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const fullBodyDisplay = form.fullBodyImageUrl || DEFAULT_FULL_BODY_IMAGE;
  const headshotDisplay = form.headshotImageUrl || DEFAULT_HEADSHOT_IMAGE;
  const avatarDisplay = normalizeAvatarUrl(form.avatarUrl) ?? normalizeAvatarUrl(user?.picture);

  return (
    <div className="mx-auto max-w-6xl">
      <Card className="p-7 md:p-9">
        <CardHeader>
          <CardTitle className="text-5xl">{isEditingProfile ? "Edit Profile" : "Create Profile"}</CardTitle>
          <CardDescription>
            {isEditingProfile
              ? "Update your body profile so WearWise can keep improving outfit recommendations."
              : "If this is your first login, fill in your basic body profile so WearWise can generate better outfit recommendations."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="mb-7 flex justify-center">
                <div className="relative h-24 w-24 overflow-hidden rounded-full border border-pebble bg-[rgba(28,28,28,0.04)]">
                  {avatarDisplay ? (
                    <img src={avatarDisplay} alt="Avatar preview" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-2xl font-semibold text-charcoal">
                      {(form.name.trim().charAt(0) || "U").toUpperCase()}
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-2 flex justify-center gap-2">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => void handleImageUpload("avatarUrl", event)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploadingField !== null}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {uploadingField === "avatarUrl" ? "Uploading..." : "Upload Avatar"}
                </Button>
                {form.avatarUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={uploadingField !== null}
                    onClick={() => {
                      updateField("avatarUrl", "");
                      if (avatarInputRef.current) {
                        avatarInputRef.current.value = "";
                      }
                    }}
                  >
                    Remove Avatar
                  </Button>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-dim">Name</label>
                <Input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Your name" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-dim">Height (cm)</label>
                  <Input
                    value={form.heightCm}
                    onChange={(event) => updateField("heightCm", event.target.value)}
                    inputMode="numeric"
                    placeholder="170"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-dim">Weight (kg)</label>
                  <Input
                    value={form.weightKg}
                    onChange={(event) => updateField("weightKg", event.target.value)}
                    inputMode="numeric"
                    placeholder="60"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-dim">Sex (optional)</label>
                <select
                  className="h-11 w-full rounded-lg border border-pebble bg-cream px-4 text-sm text-charcoal focus-visible:outline-none focus-visible:shadow-focus-warm"
                  value={form.sex}
                  onChange={(event) => updateField("sex", event.target.value)}
                >
                  <option value="">Prefer not to say</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-dim">Style Preference (optional)</label>
                <Textarea
                  value={form.styleNote}
                  onChange={(event) => updateField("styleNote", event.target.value)}
                  placeholder="Example: minimal, neutral palette, smart casual"
                />
              </div>

              {error ? <p className="text-sm text-red-700">{error}</p> : null}

              <div className="flex flex-wrap gap-3 pt-2">
                <Button type="submit" disabled={isSaving || uploadingField !== null}>
                  {isSaving ? "Saving..." : "Save Profile"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isSaving || uploadingField !== null}
                  onClick={() => {
                    logout();
                    navigate("/");
                  }}
                >
                  Logout
                </Button>
              </div>
            </form>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 lg:justify-self-end">
              <div className="space-y-2">
                <label className="mb-1 block text-sm font-medium text-dim">Headshot (optional)</label>
                <div className="group relative block h-[280px] w-[200px] overflow-hidden rounded-xl border border-pebble bg-[rgba(28,28,28,0.04)]">
                  <img src={headshotDisplay} alt="Headshot preview" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                  {form.headshotImageUrl ? (
                    <button
                      type="button"
                      className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-cream/95 text-lg leading-none text-charcoal shadow"
                      onClick={() => {
                        updateField("headshotImageUrl", "");
                        if (headshotInputRef.current) {
                          headshotInputRef.current.value = "";
                        }
                      }}
                      aria-label="Reset headshot image"
                    >
                      x
                    </button>
                  ) : null}
                </div>
                <input
                  ref={headshotInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => void handleImageUpload("headshotImageUrl", event)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={uploadingField !== null}
                  onClick={() => headshotInputRef.current?.click()}
                >
                  {uploadingField === "headshotImageUrl" ? "Uploading..." : "Upload Image"}
                </Button>
              </div>

              <div className="space-y-2">
                <label className="mb-1 block text-sm font-medium text-dim">Full-body (required)</label>
                <div className="group relative block h-[280px] w-[200px] overflow-hidden rounded-xl border border-pebble bg-[rgba(28,28,28,0.04)]">
                  <img src={fullBodyDisplay} alt="Full-body preview" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                  {form.fullBodyImageUrl ? (
                    <button
                      type="button"
                      className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-cream/95 text-lg leading-none text-charcoal shadow"
                      onClick={() => {
                        updateField("fullBodyImageUrl", "");
                        if (fullBodyInputRef.current) {
                          fullBodyInputRef.current.value = "";
                        }
                      }}
                      aria-label="Reset full-body image"
                    >
                      x
                    </button>
                  ) : null}
                </div>
                <input
                  ref={fullBodyInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => void handleImageUpload("fullBodyImageUrl", event)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={uploadingField !== null}
                  onClick={() => fullBodyInputRef.current?.click()}
                >
                  {uploadingField === "fullBodyImageUrl" ? "Uploading..." : "Upload Image"}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
