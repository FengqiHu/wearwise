import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { useAuth } from "../context/auth-context";
import type { UserProfile } from "../types";

function toPositiveNumber(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
}

export function ProfilePage() {
  const navigate = useNavigate();
  const { profile, saveProfile, logout } = useAuth();
  const isEditingProfile = Boolean(profile);

  const initialForm = useMemo(
    () => ({
      name: profile?.name ?? "",
      heightCm: profile ? String(profile.heightCm) : "",
      weightKg: profile ? String(profile.weightKg) : "",
      styleNote: profile?.styleNote ?? "",
      avatarUrl: profile?.avatarUrl ?? ""
    }),
    [profile]
  );

  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);

  const updateField = (field: keyof typeof form, value: string): void => {
    setForm((previous) => ({
      ...previous,
      [field]: value
    }));
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

    const nextProfile: UserProfile = {
      name: form.name.trim(),
      heightCm,
      weightKg,
      styleNote: form.styleNote.trim(),
      avatarUrl: form.avatarUrl.trim() || undefined
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

  return (
    <div className="mx-auto max-w-2xl">
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
          <div className="mb-7 flex justify-center">
            <div className="grid h-24 w-24 place-items-center rounded-full border border-boutique-300 bg-boutique-100 text-2xl font-semibold text-boutique-800">
              {(form.name.trim().charAt(0) || "U").toUpperCase()}
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1 block text-sm font-medium text-boutique-700">Name</label>
              <Input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Your name" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-boutique-700">Height (cm)</label>
                <Input
                  value={form.heightCm}
                  onChange={(event) => updateField("heightCm", event.target.value)}
                  inputMode="numeric"
                  placeholder="170"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-boutique-700">Weight (kg)</label>
                <Input
                  value={form.weightKg}
                  onChange={(event) => updateField("weightKg", event.target.value)}
                  inputMode="numeric"
                  placeholder="60"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-boutique-700">Avatar URL (optional)</label>
              <Input
                value={form.avatarUrl}
                onChange={(event) => updateField("avatarUrl", event.target.value)}
                placeholder="https://example.com/avatar.jpg"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-boutique-700">Style Preference (optional)</label>
              <Textarea
                value={form.styleNote}
                onChange={(event) => updateField("styleNote", event.target.value)}
                placeholder="Example: minimal, neutral palette, smart casual"
              />
            </div>

            {error ? <p className="text-sm text-red-700">{error}</p> : null}

            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Profile"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={isSaving}
                onClick={() => {
                  logout();
                  navigate("/");
                }}
              >
                Logout
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
