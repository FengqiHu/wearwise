import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
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
  deleteChatConversation,
  fetchChatConversation,
  fetchChatConversations,
  fetchClosetItems,
  generateOutfit,
  streamChatResponse,
  type UserLocation
} from "../lib/api";
import { cn } from "../lib/cn";
import type { ChatConversationSummary, ChatMessage, ClothingItem } from "../types";

interface OutfitItem {
  id: string;
  name: string;
}

interface Outfit {
  outfitName: string;
  reason: string;
  items: OutfitItem[];
}

interface OutfitResponse {
  outfits: Outfit[];
}

interface OutfitGenerationState {
  generatedImageUrl: string | null;
  error: string | null;
  isLoading: boolean;
}

function parseOutfitResponse(content: string): OutfitResponse | null {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "outfits" in parsed &&
      Array.isArray((parsed as OutfitResponse).outfits)
    ) {
      return parsed as OutfitResponse;
    }
    return null;
  } catch {
    return null;
  }
}

function buildOutfitGenerationKey(messageId: string, outfitIndex: number, outfit: Outfit): string {
  return `${messageId}:${outfitIndex}:${outfit.items.map((item) => item.id).join(",")}`;
}

function buildGenerationStatesFromMessages(messages: ChatMessage[]): Record<string, OutfitGenerationState> {
  const nextStates: Record<string, OutfitGenerationState> = {};

  for (const message of messages) {
    for (const tryOnImage of message.tryOnImages ?? []) {
      nextStates[tryOnImage.outfitKey] = {
        generatedImageUrl: tryOnImage.imageUrl,
        error: null,
        isLoading: false
      };
    }
  }

  return nextStates;
}

function upsertTryOnImageInMessages(
  messages: ChatMessage[],
  messageId: string,
  outfitKey: string,
  imageUrl: string
): ChatMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    const nextTryOnImages = [
      ...(message.tryOnImages ?? []).filter((entry) => entry.outfitKey !== outfitKey),
      {
        outfitKey,
        imageUrl,
        createdAt: new Date().toISOString()
      }
    ];

    return {
      ...message,
      tryOnImages: nextTryOnImages
    };
  });
}

function OutfitCards({
  messageId,
  outfits,
  closetItems,
  generationStates,
  onGenerateTryOn
}: {
  messageId: string;
  outfits: Outfit[];
  closetItems: ClothingItem[];
  generationStates: Record<string, OutfitGenerationState>;
  onGenerateTryOn: (outfitKey: string, clothingItemIds: string[]) => Promise<void>;
}) {
  const itemMap = useMemo(() => {
    const map = new Map<string, ClothingItem>();
    for (const item of closetItems) map.set(item.id, item);
    return map;
  }, [closetItems]);

  return (
    <div className="flex flex-col gap-3 w-full">
      <p className="text-xs font-medium text-boutique-600 uppercase tracking-wide">Outfit Recommendations</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {outfits.map((outfit, index) => {
          const outfitKey = buildOutfitGenerationKey(messageId, index, outfit);
          const generationState = generationStates[outfitKey] ?? {
            generatedImageUrl: null,
            error: null,
            isLoading: false
          };
          const clothingItemIds = outfit.items.map((item) => item.id).filter(Boolean);

          return (
            <div
              key={outfitKey}
              className="flex flex-col gap-3 rounded-2xl border border-boutique-200 bg-boutique-50/85 p-3 shadow-sm"
            >
              <p className="font-display text-lg leading-snug text-boutique-900">{outfit.outfitName}</p>

              <div className="flex flex-wrap gap-2">
                {outfit.items.map((item) => {
                  const closetItem = itemMap.get(item.id);
                  return closetItem ? (
                    <img
                      key={item.id}
                      src={closetItem.imageUrl}
                      alt={item.name}
                      title={item.name}
                      className="h-16 w-16 rounded-xl border border-boutique-200 object-cover shadow-sm"
                    />
                  ) : (
                    <div
                      key={item.id}
                      title={item.name}
                      className="flex h-16 w-16 items-center justify-center rounded-xl border border-boutique-200 bg-boutique-100 text-xs text-boutique-500"
                    >
                      ?
                    </div>
                  );
                })}
              </div>

              <p className="text-xs leading-relaxed text-boutique-700">{outfit.reason}</p>

              {generationState.generatedImageUrl ? (
                <div className="overflow-hidden rounded-2xl border border-boutique-200 bg-white/80">
                  <img
                    src={generationState.generatedImageUrl}
                    alt={`${outfit.outfitName} try-on`}
                    className="h-80 w-full object-cover md:h-96"
                  />
                </div>
              ) : null}

              {generationState.error ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
                  {generationState.error}
                </p>
              ) : null}

              <Button
                variant="outline"
                size="sm"
                disabled={generationState.isLoading || clothingItemIds.length === 0}
                className="mt-auto w-full"
                onClick={() => {
                  void onGenerateTryOn(outfitKey, clothingItemIds);
                }}
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

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: role,
    content: content
  };
}

function formatConversationTime(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isSameDay) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleDateString();
}

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
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchClosetItems(token)
      .then(setClosetItems)
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);

  useEffect(() => {
    if (!navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        });
      },
      () => {
        // Permission denied or unavailable — location stays null
      },
      { timeout: 10000 }
    );
  }, []);

  useEffect(() => {
    if (!token) {
      setConversations([]);
      setActiveConversationId(null);
      setMessages([greeting]);
      setOutfitGenerationStates({});
      setIsLoadingHistory(false);
      return;
    }

    let active = true;

    const loadHistory = async (): Promise<void> => {
      setIsLoadingHistory(true);
      setHistoryError(null);

      try {
        const list = await fetchChatConversations(token);

        if (!active) {
          return;
        }

        setConversations(list);

        if (list.length === 0) {
          setActiveConversationId(null);
          setMessages([greeting]);
          setOutfitGenerationStates({});
          return;
        }

        const firstConversationId = list[0].id;
        const detail = await fetchChatConversation(token, firstConversationId);

        if (!active) {
          return;
        }

        setActiveConversationId(firstConversationId);
        setMessages(detail.messages);
        setOutfitGenerationStates(buildGenerationStatesFromMessages(detail.messages));
      } catch (error) {
        if (!active) {
          return;
        }

        const message = error instanceof Error ? error.message : "Failed to load chat history.";
        setHistoryError(message);
        setActiveConversationId(null);
        setMessages([greeting]);
        setOutfitGenerationStates({});
      } finally {
        if (active) {
          setIsLoadingHistory(false);
        }
      }
    };

    void loadHistory();

    return () => {
      active = false;
    };
  }, [token, greeting]);

  const refreshConversationList = useCallback(
    async (nextActiveConversationId?: string): Promise<void> => {
      if (!token) {
        return;
      }

      try {
        const list = await fetchChatConversations(token);
        setConversations(list);

        if (nextActiveConversationId && list.some((entry) => entry.id === nextActiveConversationId)) {
          setActiveConversationId(nextActiveConversationId);
        }
      } catch {
        // Do not interrupt active chat interaction if list refresh fails.
      }
    },
    [token]
  );

  const loadConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      if (!token || isGenerating || deletingConversationId === conversationId) {
        return;
      }

      setIsLoadingConversation(true);
      setHistoryError(null);

      try {
        const detail = await fetchChatConversation(token, conversationId);
        setActiveConversationId(conversationId);
        setMessages(detail.messages);
        setOutfitGenerationStates(buildGenerationStatesFromMessages(detail.messages));
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
    if (isGenerating) {
      return;
    }

    setActiveConversationId(null);
    setMessages([greeting]);
    setOutfitGenerationStates({});
    setInput("");
    setHistoryError(null);
  }, [greeting, isGenerating]);

  const handleDeleteConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      if (!token || isGenerating || isLoadingConversation || deletingConversationId) {
        return;
      }

      const target = conversations.find((entry) => entry.id === conversationId);
      const title = target?.title ?? "this conversation";
      const confirmed = window.confirm(`Delete "${title}"? This action cannot be undone.`);

      if (!confirmed) {
        return;
      }

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
            } finally {
              setIsLoadingConversation(false);
            }
          } else {
            setMessages([greeting]);
            setOutfitGenerationStates({});
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

  const appendChunkToMessage = (id: string, chunk: string): void => {
    setMessages((previous) =>
      previous.map((message) => {
        if (message.id !== id) {
          return message;
        }

        return {
          ...message,
          content: `${message.content}${chunk}`
        };
      })
    );
  };

  const sendMessage = async (): Promise<void> => {
    const nextInput = input.trim();

    if (!token || !nextInput || isGenerating || isLoadingConversation) {
      return;
    }

    const userMessage = createMessage("user", nextInput);
    const assistantMessage = createMessage("assistant", "");

    setMessages((previous) => [...previous, userMessage, assistantMessage]);
    setInput("");

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);
    let responseConversationId: string | null = activeConversationId;

    try {
      await streamChatResponse(
        token,
        {
          message: nextInput,
          conversationId: activeConversationId ?? undefined,
          userLocation: userLocation ?? undefined
        },
        controller.signal,
        (chunk) => {
          appendChunkToMessage(assistantMessage.id, chunk);
        },
        (conversationId) => {
          responseConversationId = conversationId;
          setActiveConversationId(conversationId);
        }
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        appendChunkToMessage(assistantMessage.id, "\n\n(Stopped)");
      } else {
        appendChunkToMessage(
          assistantMessage.id,
          "\n\nUnable to reach the AI service right now. Please check server status and try again."
        );
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
      await refreshConversationList(responseConversationId ?? undefined);
    }
  };

  const stopGeneration = (): void => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  };

  const handleGenerateTryOn = useCallback(
    async (messageId: string, outfitKey: string, clothingItemIds: string[]): Promise<void> => {
      if (!token || clothingItemIds.length === 0) {
        return;
      }

      const conversationId = activeConversationId;
      if (!conversationId) {
        setOutfitGenerationStates((previous) => ({
          ...previous,
          [outfitKey]: {
            generatedImageUrl: previous[outfitKey]?.generatedImageUrl ?? null,
            error: "Open or create a saved conversation before generating a try-on image.",
            isLoading: false
          }
        }));
        return;
      }

      setOutfitGenerationStates((previous) => ({
        ...previous,
        [outfitKey]: {
          generatedImageUrl: previous[outfitKey]?.generatedImageUrl ?? null,
          error: null,
          isLoading: true
        }
      }));

      try {
        const generatedImageUrl = await generateOutfit(token, clothingItemIds, {
          conversationId,
          messageId,
          outfitKey
        });

        setMessages((previous) => upsertTryOnImageInMessages(previous, messageId, outfitKey, generatedImageUrl));

        setOutfitGenerationStates((previous) => ({
          ...previous,
          [outfitKey]: {
            generatedImageUrl,
            error: null,
            isLoading: false
          }
        }));
      } catch (error) {
        setOutfitGenerationStates((previous) => ({
          ...previous,
          [outfitKey]: {
            generatedImageUrl: previous[outfitKey]?.generatedImageUrl ?? null,
            error: error instanceof Error ? error.message : "Failed to generate a try-on image.",
            isLoading: false
          }
        }));
      }
    },
    [activeConversationId, token]
  );

  return (
    <section className="grid h-[calc(100vh-9.5rem)] w-full max-w-none gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="flex flex-col overflow-hidden p-3">
        <Button className="w-full" onClick={startNewChat} disabled={isGenerating}>
          New Chat
        </Button>

        <div className="mt-3 flex-1 space-y-2 overflow-y-auto rounded-2xl bg-boutique-50/60 p-2">
          {isLoadingHistory ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-boutique-700">
              <ThinkingDots />
              <span>Loading chat history...</span>
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-3 text-sm text-boutique-600">No conversations yet.</p>
          ) : (
            conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={cn(
                  "flex items-start gap-2 rounded-xl px-2 py-2 transition",
                  activeConversationId === conversation.id
                    ? "bg-boutique-100/80 shadow-sm"
                    : "bg-boutique-50 hover:bg-boutique-100/55"
                )}
              >
                <button
                  type="button"
                  disabled={isGenerating || deletingConversationId === conversation.id}
                  onClick={() => {
                    void loadConversation(conversation.id);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-semibold text-boutique-900">{conversation.title}</p>
                  <p className="mt-1 truncate text-xs text-boutique-600">
                    {conversation.lastMessagePreview || "No preview available."}
                  </p>
                  <p className="mt-1 text-xs text-boutique-500">{formatConversationTime(conversation.updatedAt)}</p>
                </button>

                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 rounded-full px-0 text-boutique-600 hover:text-red-700"
                  disabled={isGenerating || deletingConversationId === conversation.id}
                  onClick={() => {
                    void handleDeleteConversation(conversation.id);
                  }}
                  aria-label={`Delete ${conversation.title}`}
                >
                  x
                </Button>
              </div>
            ))
          )}

          {historyError ? <p className="px-2 text-xs text-red-700">{historyError}</p> : null}
        </div>
      </Card>

      <div className="flex min-h-0 flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-5xl leading-tight text-boutique-900">AI Stylist Chat</h1>
            <p className="mt-1 text-sm text-boutique-700">Ask for outfit suggestions by weather, occasion, or style preference.</p>
          </div>

          {activeConversationId ? (
            <Button
              variant="danger"
              size="sm"
              disabled={isGenerating || isLoadingConversation || deletingConversationId === activeConversationId}
              onClick={() => {
                void handleDeleteConversation(activeConversationId);
              }}
            >
              Delete Chat
            </Button>
          ) : null}
        </header>

        <Card className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-boutique-200 bg-boutique-50 p-4">
            {isLoadingConversation ? (
              <div className="flex items-center gap-2 text-sm text-boutique-700">
                <ThinkingDots />
                <span>Loading conversation...</span>
              </div>
            ) : (
              messages.map((message, index) => {
                const isThinking =
                  message.role === "assistant" && message.content.length === 0 && isGenerating && index === messages.length - 1;

                return (
                  <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[95%] rounded-2xl px-4 py-3 text-sm shadow-sm md:max-w-[88%]",
                        message.role === "user"
                          ? "bg-boutique-800 text-boutique-50"
                          : "border border-boutique-200 bg-boutique-100/70 text-boutique-900"
                      )}
                    >
                      {isThinking ? (
                        <ThinkingDots />
                      ) : (() => {
                        const outfitData = message.role === "assistant" ? parseOutfitResponse(message.content) : null;
                        if (outfitData) {
                          return (
                            <OutfitCards
                              messageId={message.id}
                              outfits={outfitData.outfits}
                              closetItems={closetItems}
                              generationStates={outfitGenerationStates}
                              onGenerateTryOn={(outfitKey, clothingItemIds) =>
                                handleGenerateTryOn(message.id, outfitKey, clothingItemIds)
                              }
                            />
                          );
                        }
                        return <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>;
                      })()}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={scrollAnchorRef} />
          </div>

          {!isGenerating && input.trim().length === 0 ? (
            <PromptSuggestions className="px-1 pb-1">
              {quickPrompts.map((prompt) => (
                <PromptSuggestion
                  key={prompt}
                  onClick={() => {
                    setInput(prompt);
                  }}
                >
                  {prompt}
                </PromptSuggestion>
              ))}
            </PromptSuggestions>
          ) : null}

          <PromptInput
            value={input}
            onSubmit={() => {
              void sendMessage();
            }}
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
                  <Button variant="danger" className="min-w-28" onClick={stopGeneration}>
                    Stop
                  </Button>
                ) : (
                  <Button
                    className="min-w-28"
                    onClick={() => {
                      void sendMessage();
                    }}
                    disabled={!input.trim() || isLoadingConversation}
                  >
                    Send
                  </Button>
                )}
              </PromptInputAction>
            </PromptInputActions>
          </PromptInput>
        </Card>
      </div>
    </section>
  );
}
