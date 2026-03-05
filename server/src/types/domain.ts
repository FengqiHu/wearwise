export interface ChatRequest {
  message: string;
  conversationId?: string;
}

export interface UserProfile {
  name: string;
  heightCm: number;
  weightKg: number;
  styleNote: string;
  avatarUrl: string | null;
}

export interface UserRecord {
  id: string;
  googleSub: string;
  email: string;
  name: string;
  picture: string | null;
  profile: UserProfile | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionPayload {
  userId: string;
  iat: number;
  exp: number;
}

export interface GoogleTokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  emailVerified: boolean | null;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface AuthError {
  status: number;
  message: string;
}

export type ChatRole = "user" | "assistant";

export interface StoredChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export interface ConversationRecord {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messages: StoredChatMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  messageCount: number;
}

export type ClosetItemStatus = "pending" | "ready";

export interface ClosetItemRecord {
  id: string;
  userId: string;
  imageUrl: string;
  analysisStatus: ClosetItemStatus;
  name: string | null;
  category: string | null;
  tags: string[];
  description: string | null;
  createdAt: string;
  updatedAt: string;
}
