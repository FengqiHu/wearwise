import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfilePage } from "./profile-page";
import type { UserProfile } from "../types";

const authMocks = vi.hoisted(() => ({
  saveProfile: vi.fn(),
  logout: vi.fn(),
  token: "test-token",
  user: { id: "u1", name: "Alice", email: "alice@example.com", picture: null },
  profile: null as UserProfile | null
}));

vi.mock("../context/auth-context", () => ({
  useAuth: () => ({
    token: authMocks.token,
    user: authMocks.user,
    profile: authMocks.profile,
    isAuthenticated: true,
    isBootstrapping: false,
    setSessionToken: vi.fn(),
    saveProfile: authMocks.saveProfile,
    refreshSession: vi.fn(),
    logout: authMocks.logout
  })
}));

function buildProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    name: "Alice",
    heightCm: 165,
    weightKg: 55,
    styleNote: "smart casual",
    avatarUrl: null,
    fullBodyImageUrl: "https://example.com/full-body.png",
    headshotImageUrl: null,
    ...overrides
  };
}

function renderProfilePage() {
  return render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>
  );
}

function getFormFields() {
  return {
    nameInput: screen.getByPlaceholderText("Your name"),
    heightInput: screen.getByPlaceholderText("170"),
    weightInput: screen.getByPlaceholderText("60"),
    styleNoteInput: screen.getByPlaceholderText(/minimal, neutral palette, smart casual/i)
  };
}

describe("ProfilePage", () => {
  beforeEach(() => {
    authMocks.profile = null;
    authMocks.saveProfile.mockReset();
    authMocks.logout.mockReset();
  });

  it("renders the basic profile form fields", () => {
    renderProfilePage();

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Height (cm)")).toBeInTheDocument();
    expect(screen.getByText("Weight (kg)")).toBeInTheDocument();
    expect(screen.getByText("Style Preference (optional)")).toBeInTheDocument();

    const { nameInput, heightInput, weightInput, styleNoteInput } = getFormFields();

    expect(nameInput).toBeInTheDocument();
    expect(heightInput).toBeInTheDocument();
    expect(weightInput).toBeInTheDocument();
    expect(styleNoteInput).toBeInTheDocument();
  });

  it("prefills the form with the existing profile data", () => {
    authMocks.profile = buildProfile({
      name: "Taylor",
      heightCm: 180,
      weightKg: 72,
      styleNote: "layered neutrals"
    });

    renderProfilePage();

    const { nameInput, heightInput, weightInput, styleNoteInput } = getFormFields();

    expect(nameInput).toHaveValue("Taylor");
    expect(heightInput).toHaveValue("180");
    expect(weightInput).toHaveValue("72");
    expect(styleNoteInput).toHaveValue("layered neutrals");
  });

  it("shows a validation error when the name is empty", async () => {
    const user = userEvent.setup();
    authMocks.profile = buildProfile();

    renderProfilePage();

    const { nameInput } = getFormFields();

    await user.clear(nameInput);
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect(authMocks.saveProfile).not.toHaveBeenCalled();
    await screen.findByText("Name is required.");
  });

  it("shows a validation error when height or weight is invalid", async () => {
    const user = userEvent.setup();
    authMocks.profile = buildProfile();

    renderProfilePage();

    const { heightInput, weightInput } = getFormFields();

    await user.clear(heightInput);
    await user.type(heightInput, "0");
    await user.clear(weightInput);
    await user.type(weightInput, "abc");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect(authMocks.saveProfile).not.toHaveBeenCalled();
    await screen.findByText("Height and weight must be valid positive numbers.");
  });

  it("calls saveProfile with parsed and trimmed values on a valid submit", async () => {
    const user = userEvent.setup();
    authMocks.profile = buildProfile();
    authMocks.saveProfile.mockResolvedValue(undefined);

    renderProfilePage();

    const { nameInput, heightInput, weightInput, styleNoteInput } = getFormFields();

    await user.clear(nameInput);
    await user.type(nameInput, "  Avery  ");
    await user.clear(heightInput);
    await user.type(heightInput, "172");
    await user.clear(weightInput);
    await user.type(weightInput, "58");
    await user.clear(styleNoteInput);
    await user.type(styleNoteInput, "  polished layers  ");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => {
      expect(authMocks.saveProfile).toHaveBeenCalledOnce();
    });

    expect(authMocks.saveProfile).toHaveBeenCalledWith({
      name: "Avery",
      heightCm: 172,
      weightKg: 58,
      styleNote: "polished layers",
      avatarUrl: undefined,
      fullBodyImageUrl: "https://example.com/full-body.png",
      headshotImageUrl: undefined
    });
  });

  it("disables the Save Profile button while saveProfile is pending", async () => {
    const user = userEvent.setup();
    authMocks.profile = buildProfile();

    let resolveSave: () => void;
    authMocks.saveProfile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );

    renderProfilePage();

    const saveButton = screen.getByRole("button", { name: /save profile/i });

    await user.click(saveButton);

    await waitFor(() => {
      expect(saveButton).toBeDisabled();
      expect(saveButton).toHaveTextContent("Saving...");
    });

    resolveSave!();

    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
  });

  it("shows the save error message when saveProfile fails", async () => {
    const user = userEvent.setup();
    authMocks.profile = buildProfile();
    authMocks.saveProfile.mockRejectedValue(new Error("Profile save failed."));

    renderProfilePage();

    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect(authMocks.saveProfile).toHaveBeenCalledOnce();
    await screen.findByText("Profile save failed.");
  });
});
