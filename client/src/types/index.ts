export const CLOTHING_CATEGORIES = [
  "tops",
  "pants",
  "outerwear",
  "shoes",
  "accessories"
] as const;

export type ClothingCategory = (typeof CLOTHING_CATEGORIES)[number];

export type ClothingStatus = "finished" | "unfinished";

export interface ClothingItem {
  id: string;
  title: string;
  tags: string[];
  category: ClothingCategory;
  description: string;
  imageUrl: string;
  status: ClothingStatus;
  createdAt: string;
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

export interface OutfitRecommendation {
  outfit: OutfitItem[];
  styleNote: string;
}

export interface ClosetItemRecord {
  id: string;
  userId: string;
  imageUrl: string;
  analysisStatus: "pending" | "ready" | "error";
  analysisError: string | null;
  name: string | null;
  category: string | null;
  tags: string[];
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  name: string;
  heightCm: number;
  weightKg: number;
  styleNote: string;
  avatarUrl?: string | null;
  fullBodyImageUrl?: string | null;
  headshotImageUrl?: string | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  tryOnImages?: Array<{
    outfitKey: string;
    imageUrl: string;
    createdAt: string;
  }>;
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  messageCount: number;
}

export interface ChatConversationDetail {
  conversation: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    lastMessageAt: string;
  };
  messages: ChatMessage[];
}
