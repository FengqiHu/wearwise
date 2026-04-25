import type { ClothingItem, ClothingStatus, UserProfile } from "../types";

const AUTH_TOKEN_KEY = "wearwise.auth.token";
const PROFILE_KEY = "wearwise.user.profile";
const WARDROBE_KEY = "wearwise.wardrobe.items";
const ACCOUNT_DELETED_NOTICE_KEY = "wearwise.account.deleted.notice";

function readJson<T>(key: string, fallback: T): T {
  const rawValue = localStorage.getItem(key);
  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function createPlaceholderImage(label: string, accentColor: string): string {
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 820'>
      <defs>
        <linearGradient id='bg' x1='0' x2='1' y1='0' y2='1'>
          <stop offset='0%' stop-color='#F8F5EE' />
          <stop offset='100%' stop-color='#EFE5D8' />
        </linearGradient>
      </defs>
      <rect width='640' height='820' fill='url(#bg)'/>
      <rect x='40' y='40' width='560' height='740' rx='34' fill='none' stroke='${accentColor}' stroke-width='6' stroke-dasharray='16 12' opacity='0.65'/>
      <circle cx='320' cy='330' r='98' fill='${accentColor}' opacity='0.12'/>
      <path d='M260 540h120' stroke='${accentColor}' stroke-width='12' stroke-linecap='round' opacity='0.5'/>
      <text x='50%' y='52%' dominant-baseline='middle' text-anchor='middle' fill='${accentColor}' font-size='68' font-family='Georgia, serif'>${label}</text>
      <text x='50%' y='86%' dominant-baseline='middle' text-anchor='middle' fill='#6a5540' font-size='28' font-family='Arial, sans-serif'>WearWise placeholder image</text>
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const defaultWardrobeItems: ClothingItem[] = [
  {
    id: "demo-top-01",
    title: "Ivory Silk Blouse",
    category: "tops",
    tags: ["minimal", "spring", "office"],
    description:
      "Soft drape silk blouse with clean neckline. Easy to pair with tailored pants and neutral outerwear.",
    imageUrl: createPlaceholderImage("TOP", "#9C7B57"),
    status: "finished",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString()
  },
  {
    id: "demo-pants-01",
    title: "Taupe Wide-Leg Pants",
    category: "pants",
    tags: ["smart-casual", "all-season"],
    description:
      "High-waisted wide-leg pants in a warm taupe shade. Structured fit with breathable fabric.",
    imageUrl: createPlaceholderImage("PANTS", "#7A6047"),
    status: "finished",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString()
  },
  {
    id: "demo-shoes-01",
    title: "Cream Leather Sneakers",
    category: "shoes",
    tags: ["daily", "comfortable"],
    description:
      "Low-profile leather sneakers with subtle gold details. Designed for long city walks.",
    imageUrl: createPlaceholderImage("SHOES", "#A98054"),
    status: "finished",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString()
  },
  {
    id: "demo-coat-01",
    title: "Camel Wool Coat",
    category: "outerwear",
    tags: ["winter", "statement"],
    description:
      "Long-line wool coat with dropped shoulders and belt tie. AI analysis is still in progress.",
    imageUrl: createPlaceholderImage("COAT", "#8C6A46"),
    status: "unfinished",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString()
  }
];

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function markAccountDeletedNotice(): void {
  sessionStorage.setItem(ACCOUNT_DELETED_NOTICE_KEY, "1");
}

export function consumeAccountDeletedNotice(): boolean {
  const hasNotice = sessionStorage.getItem(ACCOUNT_DELETED_NOTICE_KEY) === "1";

  if (hasNotice) {
    sessionStorage.removeItem(ACCOUNT_DELETED_NOTICE_KEY);
  }

  return hasNotice;
}

export function getUserProfile(): UserProfile | null {
  return readJson<UserProfile | null>(PROFILE_KEY, null);
}

export function setUserProfile(profile: UserProfile): void {
  writeJson(PROFILE_KEY, profile);
}

export function clearUserProfile(): void {
  localStorage.removeItem(PROFILE_KEY);
}

export function getWardrobeItems(): ClothingItem[] {
  return readJson<ClothingItem[]>(WARDROBE_KEY, []);
}

export function setWardrobeItems(items: ClothingItem[]): void {
  writeJson(WARDROBE_KEY, items);
}

export function seedWardrobeIfEmpty(): void {
  const existing = getWardrobeItems();

  if (existing.length === 0) {
    setWardrobeItems(defaultWardrobeItems);
  }
}

export function addWardrobeItems(newItems: ClothingItem[]): ClothingItem[] {
  const existing = getWardrobeItems();
  const mergedItems = [...newItems, ...existing];
  setWardrobeItems(mergedItems);
  return mergedItems;
}

export function updateWardrobeItemsStatus(ids: string[], status: ClothingStatus): void {
  if (ids.length === 0) {
    return;
  }

  const idSet = new Set(ids);
  const updatedItems = getWardrobeItems().map((item) => {
    if (!idSet.has(item.id)) {
      return item;
    }

    return {
      ...item,
      status
    };
  });

  setWardrobeItems(updatedItems);
}
