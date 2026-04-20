import type {
  AccessoryMode,
  AuthenticatedUser,
  ChatConversationDetail,
  ChatConversationSummary,
  ClothingItem,
  ClosetItemRecord,
  OutfitRecommendation,
  RecommendationHistoryEntry,
  UserProfile
} from "../types";
import { CLOTHING_CATEGORIES } from "../types";

export type { AccessoryMode } from "../types";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export interface UserLocation {
  lat: number;
  lon: number;
  timezone: string;
}

interface ChatStreamPayload {
  message: string;
  conversationId?: string;
  accessoryMode?: AccessoryMode;
  userLocation?: UserLocation;
}

interface AuthEnvelope {
  user: AuthenticatedUser;
  profile: UserProfile | null;
  isFirstLogin: boolean;
}

interface GoogleExchangeResponse extends AuthEnvelope {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

interface GoogleExchangePayload {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

interface PresignedUploadResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
}

export type ImageUploadFolder = "avatar" | "headshot" | "full-body" | "closet";
const PRESIGNED_UPLOAD_MAX_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getErrorMessage(status: number, fallbackText: string): string {
  if (status === 401) {
    return "Authentication failed. Please sign in again.";
  }

  if (status === 403) {
    return "Account access is blocked by the provider.";
  }

  return fallbackText;
}

async function parseResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: string;
      message?: string;
      providerError?: string | null;
      providerDescription?: string | null;
    };
    if (payload.error) {
      if (payload.providerError || payload.providerDescription) {
        const details = [payload.providerError, payload.providerDescription].filter(Boolean).join(": ");
        return `${payload.error} (${details})`;
      }

      return payload.error;
    }

    if (payload.message) {
      return payload.message;
    }
  } catch {
    // Ignore parse errors and use fallback text.
  }

  return getErrorMessage(response.status, fallback);
}

function createAuthHeaders(token: string, includeContentType = true): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };

  if (includeContentType) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

export async function exchangeGoogleCode(payload: GoogleExchangePayload): Promise<GoogleExchangeResponse> {
  const formBody = new URLSearchParams();
  formBody.set("code", payload.code);
  formBody.set("redirectUri", payload.redirectUri);
  if (payload.codeVerifier) {
    formBody.set("codeVerifier", payload.codeVerifier);
  }

  const response = await fetch(`${API_BASE_URL}/api/auth/google/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: formBody.toString()
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Google OAuth exchange failed.");
    throw new Error(message);
  }

  return (await response.json()) as GoogleExchangeResponse;
}

export async function fetchCurrentSession(token: string): Promise<AuthEnvelope> {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    method: "GET",
    headers: createAuthHeaders(token, false)
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to read current session.");
    throw new Error(message);
  }

  return (await response.json()) as AuthEnvelope;
}

export async function createPresignedImageUpload(
  token: string,
  payload: { contentType: string; folder: ImageUploadFolder; fileName: string }
): Promise<PresignedUploadResponse> {
  const response = await fetch(`${API_BASE_URL}/api/uploads/presign-image`, {
    method: "POST",
    headers: createAuthHeaders(token),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to prepare image upload.");
    throw new Error(message);
  }

  const parsed = (await response.json()) as Partial<PresignedUploadResponse>;

  if (!parsed.uploadUrl || !parsed.publicUrl || !parsed.key) {
    throw new Error("Invalid upload response from server.");
  }

  return {
    uploadUrl: parsed.uploadUrl,
    publicUrl: parsed.publicUrl,
    key: parsed.key
  };
}

export async function uploadFileToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= PRESIGNED_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream"
        },
        body: file
      });

      if (!response.ok) {
        throw new Error(`S3 upload failed with status ${response.status}.`);
      }

      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown upload error.");

      if (attempt < PRESIGNED_UPLOAD_MAX_ATTEMPTS) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw new Error(`Upload failed after 3 retries: ${lastError?.message ?? "Unknown upload error."}`);
}

export async function saveProfileToApi(token: string, profile: UserProfile): Promise<AuthEnvelope> {
  const response = await fetch(`${API_BASE_URL}/api/profile`, {
    method: "POST",
    headers: createAuthHeaders(token),
    body: JSON.stringify(profile)
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to save profile.");
    throw new Error(message);
  }

  return (await response.json()) as AuthEnvelope;
}

export async function fetchChatConversations(token: string): Promise<ChatConversationSummary[]> {
  const response = await fetch(`${API_BASE_URL}/api/chat/conversations`, {
    method: "GET",
    headers: createAuthHeaders(token, false)
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to load chat history.");
    throw new Error(message);
  }

  const payload = (await response.json()) as { conversations?: ChatConversationSummary[] };
  return Array.isArray(payload.conversations) ? payload.conversations : [];
}

export async function fetchChatConversation(token: string, conversationId: string): Promise<ChatConversationDetail> {
  const response = await fetch(`${API_BASE_URL}/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
    method: "GET",
    headers: createAuthHeaders(token, false)
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to load conversation.");
    throw new Error(message);
  }

  return (await response.json()) as ChatConversationDetail;
}

export async function deleteChatConversation(token: string, conversationId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
    headers: createAuthHeaders(token, false)
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to delete conversation.");
    throw new Error(message);
  }
}

const validCategorySet = new Set<string>(CLOTHING_CATEGORIES);

function closetItemToClothingItem(record: ClosetItemRecord): ClothingItem {
  return {
    id: record.id,
    title: record.name ?? "Processing...",
    category: record.category !== null && validCategorySet.has(record.category)
      ? (record.category as ClothingItem["category"])
      : "tops",
    tags: record.tags,
    description: record.description ?? "",
    imageUrl: record.imageUrl,
    status: record.analysisStatus === "ready" ? "finished" : "unfinished",
    createdAt: record.createdAt
  };
}

interface CreateClosetItemResponse {
  item: ClosetItemRecord;
  uploadUrl: string;
}

interface ImportTestClosetItemsPayload {
  items: Array<{
    imageUrl: string;
    analysisStatus: "pending" | "ready" | "error";
    analysisError: string | null;
    name: string | null;
    category: string | null;
    tags: string[];
    description: string | null;
    createdAt?: string;
    updatedAt?: string;
  }>;
}

export async function createClosetItem(
  token: string,
  contentType: string
): Promise<CreateClosetItemResponse> {
  const response = await fetch(`${API_BASE_URL}/api/closet/items`, {
    method: "POST",
    headers: createAuthHeaders(token),
    body: JSON.stringify({ contentType })
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to create closet item.");
    throw new Error(message);
  }

  return (await response.json()) as CreateClosetItemResponse;
}

export async function fetchClosetItem(token: string, itemId: string): Promise<ClosetItemRecord> {
  const response = await fetch(`${API_BASE_URL}/api/closet/items/${encodeURIComponent(itemId)}`, {
    method: "GET",
    headers: createAuthHeaders(token, false)
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to fetch closet item.");
    throw new Error(message);
  }

  const payload = (await response.json()) as { item?: ClosetItemRecord };
  if (!payload.item) {
    throw new Error("Item not found.");
  }
  return payload.item;
}

interface UpdateClosetItemMetadataPayload {
  name?: string;
  category?: string;
  tags?: string[];
  description?: string;
}

export async function updateClosetItemMetadata(
  token: string,
  itemId: string,
  payload: UpdateClosetItemMetadataPayload
): Promise<ClosetItemRecord> {
  const response = await fetch(`${API_BASE_URL}/api/closet/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: createAuthHeaders(token),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to update closet item.");
    throw new Error(message);
  }

  const data = (await response.json()) as { item: ClosetItemRecord };
  return data.item;
}


export async function deleteClosetItem(token: string, itemId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/closet/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    headers: createAuthHeaders(token, false)
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to delete closet item.");
    throw new Error(message);
  }
}

interface ReplaceClosetItemImageResponse {
  item: ClosetItemRecord;
  uploadUrl: string;
}

export async function replaceClosetItemImage(
  token: string,
  itemId: string,
  contentType: string
): Promise<ReplaceClosetItemImageResponse> {
  const response = await fetch(`${API_BASE_URL}/api/closet/items/${encodeURIComponent(itemId)}/image`, {
    method: "PUT",
    headers: createAuthHeaders(token),
    body: JSON.stringify({ contentType })
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to replace closet item image.");
    throw new Error(message);
  }

  return (await response.json()) as ReplaceClosetItemImageResponse;
}

export async function importTestClosetItems(
  token: string,
  payload: ImportTestClosetItemsPayload
): Promise<ClosetItemRecord[]> {
  const response = await fetch(`${API_BASE_URL}/api/closet/items/import-test-data`, {
    method: "POST",
    headers: createAuthHeaders(token),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to import test closet items.");
    throw new Error(message);
  }

  const data = (await response.json()) as { items?: ClosetItemRecord[] };
  return Array.isArray(data.items) ? data.items : [];
}

export async function analyzeClosetItem(token: string, itemId: string, mimeType: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/closet/items/${encodeURIComponent(itemId)}/analyze`, {
    method: "POST",
    headers: createAuthHeaders(token),
    body: JSON.stringify({ mimeType })
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to trigger clothing analysis.");
    throw new Error(message);
  }
}

export async function fetchClosetItems(token: string): Promise<ClothingItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/closet/items`, {
    method: "GET",
    headers: createAuthHeaders(token, false)
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to fetch closet items.");
    throw new Error(message);
  }

  const payload = (await response.json()) as { items?: ClosetItemRecord[] };
  const records = Array.isArray(payload.items) ? payload.items : [];
  return records.map(closetItemToClothingItem);
}

export async function recommendOutfit(
  token: string,
  selectedItemIds: string[]
): Promise<OutfitRecommendation> {
  const response = await fetch(`${API_BASE_URL}/api/closet/recommend`, {
    method: "POST",
    headers: createAuthHeaders(token),
    body: JSON.stringify({ selectedItemIds })
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to generate outfit recommendation.");
    throw new Error(message);
  }

  return (await response.json()) as OutfitRecommendation;
}


export async function streamChatResponse(
  token: string,
  payload: ChatStreamPayload,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
  onConversationId?: (conversationId: string) => void
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: createAuthHeaders(token),
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    const message = await parseResponseError(response, `Request failed with status ${response.status}`);
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("ReadableStream is not supported in this browser.");
  }

  const conversationId = response.headers.get("X-Conversation-Id");
  if (conversationId && onConversationId) {
    onConversationId(conversationId);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    onChunk(decoder.decode(value, { stream: true }));
  }
}

export async function voteRecommendation(
  token: string,
  recommendationId: string,
  vote: "up" | "down" | null
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/recommendations/${encodeURIComponent(recommendationId)}/vote`, {
    method: "PATCH",
    headers: createAuthHeaders(token),
    body: JSON.stringify({ vote })
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to submit vote.");
    throw new Error(message);
  }
}

export async function generateOutfitByItems(
  token: string,
  clothingItemIds: string[]
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/generate/outfit`, {
    method: "POST",
    headers: createAuthHeaders(token),
    body: JSON.stringify({ clothingItemIds })
  });

  if (response.status === 422) {
    const message = await parseResponseError(response, "Unable to generate a try-on image.");
    if (/body image/i.test(message)) {
      throw new Error("You need to upload a full-body photo in your profile before generating a try-on image.");
    }

    throw new Error(message);
  }

  if (!response.ok) {
    const message = await parseResponseError(response, `Failed to generate outfit image (status ${response.status})`);
    throw new Error(message);
  }

  const data = (await response.json()) as { success: boolean; result: { imageUrl: string } | null; message?: string };

  if (!data.success || !data.result) {
    throw new Error(data.message ?? "Image generation failed.");
  }

  return data.result.imageUrl;
}

export async function generateOutfit(
  token: string,
  recommendationId: string
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/generate/outfit`, {
    method: "POST",
    headers: createAuthHeaders(token),
    body: JSON.stringify({ recommendationId })
  });

  if (response.status === 422) {
    const message = await parseResponseError(response, "Unable to generate a try-on image.");
    if (/body image/i.test(message)) {
      throw new Error("You need to upload a full-body photo in your profile before generating a try-on image.");
    }

    throw new Error(message);
  }

  if (!response.ok) {
    const message = await parseResponseError(response, `Failed to generate outfit image (status ${response.status})`);
    throw new Error(message);
  }

  const data = (await response.json()) as { success: boolean; result: { imageUrl: string } | null; message?: string };

  if (!data.success || !data.result) {
    throw new Error(data.message ?? "Image generation failed.");
  }

  return data.result.imageUrl;
}

export async function fetchRecommendationHistory(token: string): Promise<RecommendationHistoryEntry[]> {
  const response = await fetch(`${API_BASE_URL}/api/recommendations/history`, {
    method: "GET",
    headers: createAuthHeaders(token, false)
  });

  if (!response.ok) {
    const message = await parseResponseError(response, "Failed to load recommendation history.");
    throw new Error(message);
  }

  const payload = (await response.json()) as { recommendations?: RecommendationHistoryEntry[] };
  return Array.isArray(payload.recommendations) ? payload.recommendations : [];
}
