import type { AuthenticatedUser, ChatConversationDetail, ChatConversationSummary, UserProfile } from "../types";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

interface ChatStreamPayload {
  message: string;
  conversationId?: string;
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
