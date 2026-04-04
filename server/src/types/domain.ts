export interface ChatRequest {
  message: string;
  conversationId?: string;
  includeAccessories?: boolean;
  userLocation?: {
    lat: number;
    lon: number;
    timezone: string;
  };
}

export interface UserProfile {
  name: string;
  heightCm: number;
  weightKg: number;
  styleNote: string;
  avatarUrl: string | null;
  fullBodyImageUrl: string | null;
  headshotImageUrl: string | null;
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

export interface StoredTryOnImage {
  outfitKey: string;
  imageUrl: string;
  createdAt: string;
}

export interface StoredChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  tryOnImages?: StoredTryOnImage[];
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

export type ClosetItemStatus = "pending" | "ready" | "error";

export interface ClosetItemRecord {
  id: string;
  userId: string;
  imageUrl: string;
  analysisStatus: ClosetItemStatus;
  analysisError: string | null;
  name: string | null;
  category: string | null;
  tags: string[];
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutfitItem {
  id: string;
  category: string;
  name: string;
  imageUrl: string;
  tags: string[];
  description: string;
  isUserSelected: boolean;
  reason: string | null;
}

export interface RecommendOutfitResponse {
  outfit: OutfitItem[];
  styleNote: string;
}

export interface GenerateOutfitRequest {
  clothingItemIds: string[];
  conversationId?: string;
  messageId?: string;
  outfitKey?: string;
  options?: {
    scene?: string;
    style?: string;
    prompt?: string;
    aspectRatio?: string;
  };
}

export interface GenerateOutfitResponse {
  success: boolean;
  result: {
    imageUrl: string;
    generatedAt: string;
  } | null;
  message?: string;
}

export interface GenerationRecord {
  id: string;
  userId: string;
  clothingItemIds: string[];
  generatedImageUrl: string;
  createdAt: string;
}
