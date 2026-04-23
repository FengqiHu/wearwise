import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
  PromptSuggestion,
  PromptSuggestions
} from "../components/ui/prompt-input";
import { ThinkingDots } from "../components/thinking-dots";
import { useAuth } from "../context/auth-context";
import {
  AccessoryModeUpdateError,
  deleteChatConversation,
  fetchChatConversation,
  fetchChatConversations,
  fetchClosetItems,
  generateOutfit,
  setConversationAccessoryMode,
  streamChatResponse,
  voteRecommendation,
  type UserLocation
} from "../lib/api";
import { cn } from "../lib/cn";
import type { AccessoryMode, ChatConversationSummary, ChatMessage, ClothingItem, Recommendation } from "../types";

interface OutfitGenerationState {
  generatedImageUrl: string | null;
  error: string | null;
  isLoading: boolean;
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function PanelLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildGenerationStatesFromMessages(messages: ChatMessage[]): Record<string, OutfitGenerationState> {
  const nextStates: Record<string, OutfitGenerationState> = {};
  for (const message of messages) {
    for (const rec of message.recommendations ?? []) {
      if (rec.generation) {
        nextStates[rec.id] = { generatedImageUrl: rec.generation.imageUrl, error: null, isLoading: false };
      }
    }
  }
  return nextStates;
}

function RecommendationCards({
  recommendations,
  closetItems,
  generationStates,
  voteStates,
  onGenerateTryOn,
  onVote
}: {
  recommendations: Recommendation[];
  closetItems: ClothingItem[];
  generationStates: Record<string, OutfitGenerationState>;
  voteStates: Record<string, "up" | "down" | null>;
  onGenerateTryOn: (recommendationId: string) => Promise<void>;
  onVote: (recommendationId: string, vote: "up" | "down" | null) => Promise<void>;
}) {
  const itemMap = useMemo(() => {
    const map = new Map<string, ClothingItem>();
    for (const item of closetItems) map.set(item.id, item);
    return map;
  }, [closetItems]);

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-dim">Outfit Recommendations</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {recommendations.map((rec) => {
          const generationState = generationStates[rec.id] ?? { generatedImageUrl: null, error: null, isLoading: false };
          const currentVote = voteStates[rec.id] ?? rec.vote ?? null;

          return (
            <div key={rec.id} className="flex flex-col gap-3 rounded-xl border border-pebble bg-cream p-4">
              <p className="text-base font-medium leading-snug text-charcoal">{rec.outfitName}</p>

              <div className="flex flex-wrap gap-2">
                {(rec.items ?? []).map((item) => {
                  const closetItem = itemMap.get(item.id);
                  return closetItem ? (
                    <img
                      key={item.id}
                      src={closetItem.imageUrl}
                      alt={item.name}
                      title={item.name}
                      className="h-16 w-16 rounded-lg border border-pebble object-cover"
                    />
                  ) : (
                    <div
                      key={item.id}
                      title={item.name}
                      className="flex h-16 w-16 items-center justify-center rounded-lg border border-pebble bg-[rgba(28,28,28,0.04)] text-xs text-dim"
                    >
                      ?
                    </div>
                  );
                })}
              </div>

              <p className="text-xs leading-relaxed text-dim">{rec.reason}</p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Thumbs up"
                  onClick={() => { void onVote(rec.id, currentVote === "up" ? null : "up"); }}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border text-sm transition",
                    currentVote === "up"
                      ? "border-green-400 bg-green-50 text-green-700"
                      : "border-pebble bg-cream text-dim hover:border-green-300 hover:bg-green-50 hover:text-green-600"
                  )}
                >
                  👍
                </button>
                <button
                  type="button"
                  aria-label="Thumbs down"
                  onClick={() => { void onVote(rec.id, currentVote === "down" ? null : "down"); }}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border text-sm transition",
                    currentVote === "down"
                      ? "border-red-400 bg-red-50 text-red-700"
                      : "border-pebble bg-cream text-dim hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                  )}
                >
                  👎
                </button>
              </div>

              {generationState.generatedImageUrl ? (
                <div className="overflow-hidden rounded-xl border border-pebble">
                  <img
                    src={generationState.generatedImageUrl}
                    alt={`${rec.outfitName} try-on`}
                    className="h-80 w-full object-cover md:h-96"
                  />
                </div>
              ) : null}

              {generationState.error ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
                  {generationState.error}
                </p>
              ) : null}

              <Button
                variant="outline"
                size="sm"
                disabled={generationState.isLoading || (rec.items ?? []).length === 0}
                className="mt-auto w-full"
                onClick={() => { void onGenerateTryOn(rec.id); }}
              >
                {generationState.isLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <ThinkingDots />
                    <span>Generating...</span>
                  </span>
                ) : generationState.generatedImageUrl ? (
                  "Regenerate Try-On"
                ) : (
                  "Generate Try-On"
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isRawOutfitJson(content: string): boolean {
  return content.includes("```json");
}

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: crypto.randomUUID(), role, content };
}

function formatConversationTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isSameDay) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString();
}

// ── ChatPage ───────────────────────────────────────────────────────────────────

export function ChatPage() {
  const { profile, user, token } = useAuth();
  const greeting = useMemo(
    () =>
      createMessage(
        "assistant",
        `Hi ${profile?.name ?? user?.name ?? "there"}, tell me the weather, occasion, and style you want, and I can suggest outfits from your wardrobe.`
      ),
    [profile?.name, user?.name]
  );
  const quickPrompts = useMemo(
    () => [
      "Build me a smart-casual outfit for 12°C rainy weather.",
      "What should I wear to a formal dinner tonight?",
      "Suggest 3 outfits for weekend travel with my wardrobe."
    ],
    []
  );

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([greeting]);
  const [input, setInput] = useState("");
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [closetItems, setClosetItems] = useState<ClothingItem[]>([]);
  const [outfitGenerationStates, setOutfitGenerationStates] = useState<Record<string, OutfitGenerationState>>({});
  const [voteStates, setVoteStates] = useState<Record<string, "up" | "down" | null>>({});
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [accessoryMode, setAccessoryMode] = useState<AccessoryMode>("auto");
  const [accessoryModeError, setAccessoryModeError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const hasUserMessages = useMemo(() => messages.some((m) => m.role === "user"), [messages]);

  useEffect(() => {
    if (!token) return;
    fetchClosetItems(token).then(setClosetItems).catch(() => {});
  }, [token]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);

  useEffect(() => {
    setAccessoryModeError(null);
  }, [activeConversationId]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        });
      },
      () => {},
      { timeout: 10000 }
    );
  }, []);

  useEffect(() => {
    if (!token) {
      setConversations([]);
      setActiveConversationId(null);
      setMessages([greeting]);
      setOutfitGenerationStates({});
      setVoteStates({});
      setIsLoadingHistory(false);
      return;
    }

    let active = true;

    const loadHistory = async (): Promise<void> => {
      setIsLoadingHistory(true);
      setHistoryError(null);
      try {
        const list = await fetchChatConversations(token);
        if (!active) return;
        setConversations(list);
        if (list.length === 0) {
          setActiveConversationId(null);
          setMessages([greeting]);
          setOutfitGenerationStates({});
          setVoteStates({});
          return;
        }
        const firstConversationId = list[0].id;
        const detail = await fetchChatConversation(token, firstConversationId);
        if (!active) return;
        setActiveConversationId(firstConversationId);
        setMessages(detail.messages);
        setOutfitGenerationStates(buildGenerationStatesFromMessages(detail.messages));
        setAccessoryMode(detail.conversation.accessoryMode);
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Failed to load chat history.";
        setHistoryError(message);
        setActiveConversationId(null);
        setMessages([greeting]);
        setOutfitGenerationStates({});
        setVoteStates({});
      } finally {
        if (active) setIsLoadingHistory(false);
      }
    };

    void loadHistory();
    return () => { active = false; };
  }, [token, greeting]);

  const refreshConversationList = useCallback(
    async (nextActiveConversationId?: string): Promise<void> => {
      if (!token) return;
      try {
        const list = await fetchChatConversations(token);
        setConversations(list);
        if (nextActiveConversationId && list.some((entry) => entry.id === nextActiveConversationId)) {
          setActiveConversationId(nextActiveConversationId);
        }
      } catch {
        // Don't interrupt active chat if list refresh fails.
      }
    },
    [token]
  );

  const loadConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      if (!token || isGenerating || deletingConversationId === conversationId) return;
      setIsLoadingConversation(true);
      setHistoryError(null);
      try {
        const detail = await fetchChatConversation(token, conversationId);
        setActiveConversationId(conversationId);
        setMessages(detail.messages);
        setOutfitGenerationStates(buildGenerationStatesFromMessages(detail.messages));
        setAccessoryMode(detail.conversation.accessoryMode);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load conversation.";
        setHistoryError(message);
      } finally {
        setIsLoadingConversation(false);
      }
    },
    [token, isGenerating, deletingConversationId]
  );

  const startNewChat = useCallback((): void => {
    if (isGenerating) return;
    setActiveConversationId(null);
    setMessages([greeting]);
    setOutfitGenerationStates({});
    setVoteStates({});
    setInput("");
    setHistoryError(null);
    setAccessoryMode("auto");
  }, [greeting, isGenerating]);

  const handleDeleteConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      if (!token || isGenerating || isLoadingConversation || deletingConversationId) return;
      const target = conversations.find((entry) => entry.id === conversationId);
      const title = target?.title ?? "this conversation";
      if (!window.confirm(`Delete "${title}"? This action cannot be undone.`)) return;
      setDeletingConversationId(conversationId);
      setHistoryError(null);
      try {
        await deleteChatConversation(token, conversationId);
        const remainingConversations = conversations.filter((entry) => entry.id !== conversationId);
        setConversations(remainingConversations);
        if (activeConversationId === conversationId) {
          const nextConversationId = remainingConversations[0]?.id ?? null;
          setActiveConversationId(nextConversationId);
          if (nextConversationId) {
            setIsLoadingConversation(true);
            try {
              const detail = await fetchChatConversation(token, nextConversationId);
              setMessages(detail.messages);
              setOutfitGenerationStates(buildGenerationStatesFromMessages(detail.messages));
              setAccessoryMode(detail.conversation.accessoryMode);
            } finally {
              setIsLoadingConversation(false);
            }
          } else {
            setMessages([greeting]);
            setOutfitGenerationStates({});
            setVoteStates({});
            setAccessoryMode("auto");
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete conversation.";
        setHistoryError(message);
      } finally {
        setDeletingConversationId(null);
      }
    },
    [token, isGenerating, isLoadingConversation, deletingConversationId, conversations, activeConversationId, greeting]
  );

  const handleAccessoryModeChange = async (nextMode: AccessoryMode): Promise<void> => {
    const previousMode = accessoryMode;
    if (nextMode === previousMode) {
      return;
    }

    setAccessoryModeError(null);
    setAccessoryMode(nextMode);

    if (!token || !activeConversationId) {
      return;
    }

    try {
      await setConversationAccessoryMode(token, activeConversationId, nextMode);
    } catch (error) {
      setAccessoryMode(previousMode);
      if (error instanceof AccessoryModeUpdateError && error.code === "no_accessories_in_wardrobe") {
        setAccessoryModeError("You have no accessories in your wardrobe. Please upload some first.");
      } else {
        setAccessoryModeError("Failed to update accessory mode. Please try again.");
      }
    }
  };

  const appendChunkToMessage = (id: string, chunk: string): void => {
    setMessages((previous) =>
      previous.map((message) =>
        message.id !== id ? message : { ...message, content: `${message.content}${chunk}` }
      )
    );
  };

  const sendMessage = async (): Promise<void> => {
    const nextInput = input.trim();
    if (!token || !nextInput || isGenerating || isLoadingConversation) return;
    const userMessage = createMessage("user", nextInput);
    const assistantMessage = createMessage("assistant", "");
    setMessages((previous) => [...previous, userMessage, assistantMessage]);
    setInput("");
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);
    let responseConversationId: string | null = activeConversationId;
    let shouldSyncConversation = false;
    try {
      await streamChatResponse(
        token,
        {
          message: nextInput,
          conversationId: activeConversationId ?? undefined,
          accessoryMode,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          userLocation: userLocation ?? undefined
        },
        controller.signal,
        (chunk) => { appendChunkToMessage(assistantMessage.id, chunk); },
        (conversationId) => {
          responseConversationId = conversationId;
          setActiveConversationId(conversationId);
        }
      );
      shouldSyncConversation = true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        appendChunkToMessage(assistantMessage.id, "\n\n(Stopped)");
      } else {
        appendChunkToMessage(assistantMessage.id, "\n\nUnable to reach the AI service right now. Please check server status and try again.");
      }
    } finally {
      abortControllerRef.current = null;
      if (shouldSyncConversation && responseConversationId) {
        try {
          const detail = await fetchChatConversation(token, responseConversationId);
          setActiveConversationId(detail.conversation.id);
          setMessages(detail.messages);
          setOutfitGenerationStates(buildGenerationStatesFromMessages(detail.messages));
          setAccessoryMode(detail.conversation.accessoryMode);
        } catch {
          // Keep streamed local messages if sync fails.
        }
      }
      setIsGenerating(false);
      await refreshConversationList(responseConversationId ?? undefined);
    }
  };

  const stopGeneration = (): void => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  };

  const handleGenerateTryOn = useCallback(
    async (recommendationId: string): Promise<void> => {
      if (!token) return;
      setOutfitGenerationStates((previous) => ({
        ...previous,
        [recommendationId]: { generatedImageUrl: previous[recommendationId]?.generatedImageUrl ?? null, error: null, isLoading: true }
      }));
      try {
        const generatedImageUrl = await generateOutfit(token, recommendationId);
        setOutfitGenerationStates((previous) => ({
          ...previous,
          [recommendationId]: { generatedImageUrl, error: null, isLoading: false }
        }));
      } catch (error) {
        setOutfitGenerationStates((previous) => ({
          ...previous,
          [recommendationId]: {
            generatedImageUrl: previous[recommendationId]?.generatedImageUrl ?? null,
            error: error instanceof Error ? error.message : "Failed to generate a try-on image.",
            isLoading: false
          }
        }));
      }
    },
    [token]
  );

  const handleVote = useCallback(
    async (recommendationId: string, vote: "up" | "down" | null): Promise<void> => {
      if (!token) return;
      setVoteStates((previous) => ({ ...previous, [recommendationId]: vote }));
      try {
        await voteRecommendation(token, recommendationId, vote);
      } catch {
        setVoteStates((previous) => ({ ...previous, [recommendationId]: null }));
      }
    },
    [token]
  );

  return (
    <div className="flex h-full w-full bg-cream">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "flex-shrink-0 overflow-hidden border-r border-pebble bg-cream transition-[width] duration-200",
          sidebarOpen ? "w-72" : "w-0"
        )}
      >
        <div className="flex h-full w-72 flex-col px-2 py-3">
          {/* Header */}
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-dim">Conversations</span>
          </div>

          {/* New conversation button */}
          <button
            onClick={startNewChat}
            disabled={isGenerating}
            className="mb-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-charcoal transition hover:bg-[rgba(28,28,28,0.05)] disabled:opacity-50"
          >
            <PlusIcon />
            <span>New conversation</span>
          </button>

          {/* Conversation list */}
          <div className="flex-1 space-y-0.5 overflow-y-auto">
            {isLoadingHistory ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-dim">
                <ThinkingDots />
                <span>Loading...</span>
              </div>
            ) : conversations.length === 0 ? (
              <p className="px-3 py-2 text-xs text-dim">No conversations yet.</p>
            ) : (
              conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={cn(
                    "group relative flex items-stretch rounded-md transition",
                    activeConversationId === conversation.id
                      ? "bg-[rgba(28,28,28,0.08)]"
                      : "hover:bg-[rgba(28,28,28,0.05)]",
                    deletingConversationId === conversation.id && "opacity-50"
                  )}
                >
                  <button
                    type="button"
                    disabled={isGenerating || deletingConversationId === conversation.id}
                    onClick={() => { void loadConversation(conversation.id); }}
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                  >
                    <p className="truncate text-sm leading-snug text-charcoal">{conversation.title}</p>
                    <p className="mt-0.5 text-xs text-dim">{formatConversationTime(conversation.updatedAt)}</p>
                  </button>

                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-dim opacity-0 transition hover:bg-[rgba(220,38,38,0.08)] hover:text-red-600 group-hover:opacity-100"
                    disabled={isGenerating || deletingConversationId === conversation.id}
                    onClick={(e) => { e.stopPropagation(); void handleDeleteConversation(conversation.id); }}
                    aria-label={`Delete ${conversation.title}`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))
            )}
          </div>

          {historyError ? <p className="mt-2 px-3 text-xs text-red-700">{historyError}</p> : null}
        </div>
      </aside>

      {/* ── Main chat area ───────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Control bar */}
        <div className="flex h-11 flex-shrink-0 items-center justify-between border-b border-pebble px-4">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-dim transition hover:bg-[rgba(28,28,28,0.05)] hover:text-charcoal"
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <PanelLeftIcon />
          </button>

          <div className="flex items-center gap-3">
            <label className="flex select-none items-center gap-1.5 text-xs text-dim">
              <span>Accessories:</span>
              <select
                value={accessoryMode}
                onChange={(e) => {
                  void handleAccessoryModeChange(e.target.value as AccessoryMode);
                }}
                className="rounded-md border border-pebble bg-cream px-2 py-1 text-xs text-charcoal outline-none transition focus:border-[rgba(28,28,28,0.4)]"
              >
                <option value="auto">AI decides</option>
                <option value="include">Include</option>
                <option value="exclude">Exclude</option>
              </select>
            </label>

            {activeConversationId ? (
              <button
                type="button"
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-dim transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                disabled={isGenerating || isLoadingConversation || deletingConversationId === activeConversationId}
                onClick={() => { void handleDeleteConversation(activeConversationId); }}
              >
                <TrashIcon />
                <span>Delete</span>
              </button>
            ) : null}
          </div>
        </div>

        {accessoryModeError ? (
          <div className="flex-shrink-0 border-b border-pebble px-4 py-1.5">
            <p className="text-xs text-red-600">{accessoryModeError}</p>
          </div>
        ) : null}

        {/* Messages scroll area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
            {/* Title — only shown before first user message */}
            {!hasUserMessages && (
              <div className="mb-10 text-center">
                <h1 className="text-5xl font-semibold tracking-tight text-charcoal">AI Stylist Chat</h1>
                <p className="mt-3 text-base text-dim">
                  Ask for outfit suggestions by weather, occasion, or style preference.
                </p>
              </div>
            )}

            {isLoadingConversation ? (
              <div className="flex items-center gap-2 py-4 text-sm text-dim">
                <ThinkingDots />
                <span>Loading conversation...</span>
              </div>
            ) : (
              messages.map((message, index) => {
                const isThinking =
                  message.role === "assistant" &&
                  message.content.length === 0 &&
                  isGenerating &&
                  index === messages.length - 1;

                return (
                  <div
                    key={message.id}
                    className={cn("mb-6 flex", message.role === "user" ? "justify-end" : "justify-start")}
                  >
                    {message.role === "user" ? (
                      <div className="max-w-[75%] rounded-2xl bg-[rgba(28,28,28,0.07)] px-4 py-2.5 text-sm text-charcoal">
                        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                      </div>
                    ) : (
                      <div className="w-full max-w-[88%] text-sm text-charcoal">
                        {isThinking ? (
                          <ThinkingDots />
                        ) : (() => {
                          const recommendations = message.recommendations;
                          if (recommendations && recommendations.length > 0) {
                            return (
                              <RecommendationCards
                                recommendations={recommendations}
                                closetItems={closetItems}
                                generationStates={outfitGenerationStates}
                                voteStates={voteStates}
                                onGenerateTryOn={handleGenerateTryOn}
                                onVote={handleVote}
                              />
                            );
                          }
                          if (isRawOutfitJson(message.content)) {
                            return (
                              <span className="inline-flex items-center gap-2 text-dim">
                                <ThinkingDots />
                                <span>Building outfit recommendations...</span>
                              </span>
                            );
                          }
                          return <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>;
                        })()}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div ref={scrollAnchorRef} />
          </div>
        </div>

        {/* Quick suggestions — shown above input in new sessions */}
        {!hasUserMessages && !isGenerating && (
          <div className="flex-shrink-0 px-4 pb-2 md:px-6">
            <div className="mx-auto max-w-3xl">
              <PromptSuggestions>
                {quickPrompts.map((prompt) => (
                  <PromptSuggestion key={prompt} onClick={() => { setInput(prompt); }}>
                    {prompt}
                  </PromptSuggestion>
                ))}
              </PromptSuggestions>
            </div>
          </div>
        )}

        {/* Input bar */}
        <div className="flex-shrink-0 px-4 pb-16 pt-3 md:px-6">
          <div className="mx-auto max-w-3xl">
            <PromptInput
              value={input}
              onSubmit={() => { void sendMessage(); }}
              isLoading={isGenerating || isLoadingConversation}
            >
              <PromptInputTextarea
                placeholder="Tell me what you want to wear today..."
                value={input}
                onValueChange={setInput}
                isLoading={isGenerating || isLoadingConversation}
                maxHeight={180}
                className="min-h-[44px]"
              />
              <PromptInputActions>
                <PromptInputAction>
                  {isGenerating ? (
                    <Button variant="danger" className="min-w-20" onClick={stopGeneration}>
                      Stop
                    </Button>
                  ) : (
                    <Button
                      className="min-w-20"
                      onClick={() => { void sendMessage(); }}
                      disabled={!input.trim() || isLoadingConversation}
                    >
                      Send
                    </Button>
                  )}
                </PromptInputAction>
              </PromptInputActions>
            </PromptInput>
          </div>
        </div>
      </div>
    </div>
  );
}
