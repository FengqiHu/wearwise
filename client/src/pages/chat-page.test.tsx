import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "./chat-page";

vi.mock("../context/auth-context", () => ({
  useAuth: () => ({
    token: "test-token",
    user: { id: "u1", name: "Alice", email: "alice@example.com", picture: null },
    profile: null
  })
}));

const apiMocks = vi.hoisted(() => {
  class AccessoryModeUpdateError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = "AccessoryModeUpdateError";
    }
  }
  return {
    fetchChatConversations: vi.fn(),
    fetchChatConversation: vi.fn(),
    deleteChatConversation: vi.fn(),
    fetchClosetItems: vi.fn(),
    streamChatResponse: vi.fn(),
    generateOutfit: vi.fn(),
    setConversationAccessoryMode: vi.fn(),
    AccessoryModeUpdateError
  };
});

vi.mock("../lib/api", () => apiMocks);

function renderChat() {
  return render(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>
  );
}

describe("ChatPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.fetchClosetItems.mockResolvedValue([]);
    apiMocks.fetchChatConversations.mockResolvedValue([]);
    apiMocks.setConversationAccessoryMode.mockResolvedValue(undefined);
  });

  describe("initial render", () => {
    it("shows a greeting message on load", async () => {
      renderChat();
      await waitFor(() => {
        expect(screen.getByText(/tell me the weather/i)).toBeDefined();
      });
    });

    it("shows 'No conversations yet' when there is no history", async () => {
      renderChat();
      await screen.findByText("No conversations yet.");
    });

    it("shows quick prompt suggestions when input is empty", async () => {
      renderChat();
      await screen.findByText(/smart-casual outfit/i);
      expect(screen.getByText(/formal dinner/i)).toBeDefined();
      expect(screen.getByText(/weekend travel/i)).toBeDefined();
    });

    it('renders the accessory mode dropdown with three options and defaults to "AI decides"', async () => {
      renderChat();

      const accessoryModeSelect = await screen.findByRole("combobox", { name: /accessories/i });

      expect(accessoryModeSelect).toHaveValue("auto");
      expect(screen.getByRole("option", { name: "AI decides" })).toBeDefined();
      expect(screen.getByRole("option", { name: "Include" })).toBeDefined();
      expect(screen.getByRole("option", { name: "Exclude" })).toBeDefined();
    });
  });

  describe("quick prompts", () => {
    it("clicking a quick prompt fills the input field", async () => {
      const user = userEvent.setup();
      renderChat();

      const suggestion = await screen.findByText(/smart-casual outfit/i);
      await user.click(suggestion);

      const textarea = screen.getByPlaceholderText(/tell me what you want/i);
      expect((textarea as HTMLTextAreaElement).value).toMatch(/smart-casual/i);
    });

    it("hides quick prompts once a message is sent", async () => {
      const user = userEvent.setup();
      apiMocks.streamChatResponse.mockResolvedValue(undefined);
      renderChat();

      const textarea = await screen.findByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "what should I wear");
      await user.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(screen.queryByText(/smart-casual outfit/i)).toBeNull();
      });
    });
  });

  describe("sending a message", () => {
    it("appends user message to the chat on send", async () => {
      const user = userEvent.setup();
      apiMocks.streamChatResponse.mockResolvedValue(undefined);
      renderChat();

      const textarea = await screen.findByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "What should I wear today?");
      await user.click(screen.getByRole("button", { name: /send/i }));

      expect(screen.getByText("What should I wear today?")).toBeDefined();
    });

    it("calls streamChatResponse with the user message and token", async () => {
      const user = userEvent.setup();
      apiMocks.streamChatResponse.mockResolvedValue(undefined);
      renderChat();

      const textarea = await screen.findByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "Outfit for rainy day");
      await user.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(apiMocks.streamChatResponse).toHaveBeenCalledOnce();
      });

      const [calledToken, calledPayload] = apiMocks.streamChatResponse.mock.calls[0] as [string, { message: string }];
      expect(calledToken).toBe("test-token");
      expect(calledPayload.message).toBe("Outfit for rainy day");
    });

    it("sends the selected accessory mode in the request payload", async () => {
      const user = userEvent.setup();
      apiMocks.streamChatResponse.mockResolvedValue(undefined);
      renderChat();

      const accessoryModeSelect = await screen.findByRole("combobox", { name: /accessories/i });
      await user.selectOptions(accessoryModeSelect, "include");

      const textarea = await screen.findByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "Plan an outfit with accessories");
      await user.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(apiMocks.streamChatResponse).toHaveBeenCalledOnce();
      });

      const [, calledPayload] = apiMocks.streamChatResponse.mock.calls[0] as [
        string,
        { message: string; accessoryMode: "include" | "exclude" | "auto" }
      ];

      expect(calledPayload.message).toBe("Plan an outfit with accessories");
      expect(calledPayload.accessoryMode).toBe("include");
    });

    it("clears the input after sending", async () => {
      const user = userEvent.setup();
      apiMocks.streamChatResponse.mockResolvedValue(undefined);
      renderChat();

      const textarea = await screen.findByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "Rainy day outfit");
      await user.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("");
      });
    });

    it("shows Stop button while streaming and Send button after completion", async () => {
      const user = userEvent.setup();
      let resolveStream: () => void;
      apiMocks.streamChatResponse.mockImplementation(
        () => new Promise<void>((resolve) => { resolveStream = resolve; })
      );
      renderChat();

      const textarea = await screen.findByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "Hello");
      await user.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /stop/i })).toBeDefined();
      });

      resolveStream!();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /send/i })).toBeDefined();
      });
    });

    it("does not send when input is empty", async () => {
      const user = userEvent.setup();
      renderChat();

      const sendButton = await screen.findByRole("button", { name: /send/i });
      expect(sendButton).toHaveProperty("disabled", true);
      await user.click(sendButton);

      expect(apiMocks.streamChatResponse).not.toHaveBeenCalled();
    });
  });

  describe("conversation history", () => {
    it("renders conversation titles from history", async () => {
      apiMocks.fetchChatConversations.mockResolvedValue([
        { id: "conv-1", title: "Rainy Monday Outfit", lastMessagePreview: "Here are 3 suggestions", updatedAt: new Date().toISOString() },
        { id: "conv-2", title: "Formal Dinner Look", lastMessagePreview: "Try a navy blazer", updatedAt: new Date().toISOString() }
      ]);
      apiMocks.fetchChatConversation.mockResolvedValue({
        conversation: { id: "conv-1", accessoryMode: "auto" },
        messages: [{ id: "m1", role: "assistant", content: "Here are 3 suggestions" }]
      });

      renderChat();

      await screen.findByText("Rainy Monday Outfit");
      expect(screen.getByText("Formal Dinner Look")).toBeDefined();
    });

    it("New Chat button resets to greeting", async () => {
      const user = userEvent.setup();
      apiMocks.fetchChatConversations.mockResolvedValue([
        { id: "conv-1", title: "Old Chat", lastMessagePreview: "...", updatedAt: new Date().toISOString() }
      ]);
      apiMocks.fetchChatConversation.mockResolvedValue({
        conversation: { id: "conv-1", accessoryMode: "auto" },
        messages: [{ id: "m1", role: "user", content: "Hello" }]
      });

      renderChat();

      await screen.findByText("Old Chat");
      await user.click(screen.getByRole("button", { name: /new conversation/i }));

      await screen.findByText(/tell me the weather/i);
    });
  });

  describe("accessory mode sync", () => {
    it("dropdown reflects the stored accessoryMode when opening an existing conversation", async () => {
      apiMocks.fetchChatConversations.mockResolvedValue([
        { id: "conv-1", title: "Exclude Chat", lastMessagePreview: "", updatedAt: new Date().toISOString() }
      ]);
      apiMocks.fetchChatConversation.mockResolvedValue({
        conversation: { id: "conv-1", accessoryMode: "exclude" },
        messages: [{ id: "m1", role: "assistant", content: "No accessories for this one." }]
      });

      renderChat();

      const accessoryModeSelect = await screen.findByRole("combobox", { name: /accessories/i });
      await waitFor(() => {
        expect(accessoryModeSelect).toHaveValue("exclude");
      });
    });

    it("does not call the mode API when dropdown changes before any conversation exists", async () => {
      const user = userEvent.setup();
      apiMocks.fetchChatConversations.mockResolvedValue([]);
      renderChat();

      const accessoryModeSelect = await screen.findByRole("combobox", { name: /accessories/i });
      await user.selectOptions(accessoryModeSelect, "exclude");

      expect(accessoryModeSelect).toHaveValue("exclude");
      expect(apiMocks.setConversationAccessoryMode).not.toHaveBeenCalled();
    });

    it("persists the new mode to the backend when the dropdown changes on an existing conversation", async () => {
      const user = userEvent.setup();
      apiMocks.fetchChatConversations.mockResolvedValue([
        { id: "conv-1", title: "Chat", lastMessagePreview: "", updatedAt: new Date().toISOString() }
      ]);
      apiMocks.fetchChatConversation.mockResolvedValue({
        conversation: { id: "conv-1", accessoryMode: "auto" },
        messages: [{ id: "m1", role: "user", content: "Hi" }]
      });
      renderChat();

      await screen.findByText("Chat");
      const accessoryModeSelect = await screen.findByRole("combobox", { name: /accessories/i });
      await waitFor(() => {
        expect(accessoryModeSelect).toHaveValue("auto");
      });

      await user.selectOptions(accessoryModeSelect, "exclude");

      expect(accessoryModeSelect).toHaveValue("exclude");
      await waitFor(() => {
        expect(apiMocks.setConversationAccessoryMode).toHaveBeenCalledWith("test-token", "conv-1", "exclude");
      });
    });

    it("reverts the dropdown and shows a generic error when the mode API fails", async () => {
      const user = userEvent.setup();
      apiMocks.fetchChatConversations.mockResolvedValue([
        { id: "conv-1", title: "Chat", lastMessagePreview: "", updatedAt: new Date().toISOString() }
      ]);
      apiMocks.fetchChatConversation.mockResolvedValue({
        conversation: { id: "conv-1", accessoryMode: "auto" },
        messages: [{ id: "m1", role: "user", content: "Hi" }]
      });
      apiMocks.setConversationAccessoryMode.mockRejectedValue(new Error("boom"));
      renderChat();

      const accessoryModeSelect = await screen.findByRole("combobox", { name: /accessories/i });
      await waitFor(() => {
        expect(accessoryModeSelect).toHaveValue("auto");
      });

      await user.selectOptions(accessoryModeSelect, "exclude");

      await waitFor(() => {
        expect(accessoryModeSelect).toHaveValue("auto");
      });
      expect(screen.getByText(/Failed to update accessory mode/i)).toBeDefined();
    });

    it("shows the empty-wardrobe message when switching to include with no accessories", async () => {
      const user = userEvent.setup();
      apiMocks.fetchChatConversations.mockResolvedValue([
        { id: "conv-1", title: "Chat", lastMessagePreview: "", updatedAt: new Date().toISOString() }
      ]);
      apiMocks.fetchChatConversation.mockResolvedValue({
        conversation: { id: "conv-1", accessoryMode: "auto" },
        messages: [{ id: "m1", role: "user", content: "Hi" }]
      });
      apiMocks.setConversationAccessoryMode.mockRejectedValue(
        new apiMocks.AccessoryModeUpdateError("no_accessories_in_wardrobe", "no_accessories_in_wardrobe")
      );
      renderChat();

      const accessoryModeSelect = await screen.findByRole("combobox", { name: /accessories/i });
      await waitFor(() => {
        expect(accessoryModeSelect).toHaveValue("auto");
      });

      await user.selectOptions(accessoryModeSelect, "include");

      await waitFor(() => {
        expect(accessoryModeSelect).toHaveValue("auto");
      });
      expect(screen.getByText(/no accessories in your wardrobe/i)).toBeDefined();
    });

    it("drops old conversation messages (including any confirmation bubble) when switching conversations", async () => {
      const user = userEvent.setup();
      apiMocks.fetchChatConversations.mockResolvedValue([
        { id: "conv-old", title: "Older Chat", lastMessagePreview: "", updatedAt: new Date().toISOString() },
        { id: "conv-other", title: "Second Chat", lastMessagePreview: "", updatedAt: new Date().toISOString() }
      ]);
      apiMocks.fetchChatConversation.mockImplementation(async (_token: string, id: string) => {
        if (id === "conv-old") {
          return {
            conversation: { id: "conv-old", accessoryMode: "auto" },
            messages: [{ id: "m1", role: "assistant", content: "Just to confirm — would you like me to exclude accessories?" }]
          };
        }
        return {
          conversation: { id: "conv-other", accessoryMode: "auto" },
          messages: [{ id: "m2", role: "assistant", content: "Fresh conversation." }]
        };
      });
      renderChat();

      await screen.findByText(/Just to confirm/i);

      await user.click(screen.getByText("Second Chat"));

      await waitFor(() => {
        expect(screen.queryByText(/Just to confirm/i)).toBeNull();
      });
      expect(screen.getByText(/Fresh conversation/i)).toBeDefined();
    });

    it("dropdown updates after the SSE stream completes and refetch returns a new mode", async () => {
      const user = userEvent.setup();

      apiMocks.fetchChatConversations.mockResolvedValue([]);
      apiMocks.fetchChatConversation.mockResolvedValue({
        conversation: { id: "conv-new", accessoryMode: "include" },
        messages: [{ id: "m1", role: "assistant", content: "Accessories added." }]
      });
      apiMocks.streamChatResponse.mockImplementation(
        async (_token: string, _payload: unknown, _signal: unknown, _onChunk: unknown, onConversationId: (id: string) => void) => {
          onConversationId("conv-new");
        }
      );

      renderChat();

      const accessoryModeSelect = await screen.findByRole("combobox", { name: /accessories/i });
      expect(accessoryModeSelect).toHaveValue("auto");

      const textarea = screen.getByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "I want accessories");
      await user.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(accessoryModeSelect).toHaveValue("include");
      });
      expect(apiMocks.fetchChatConversation).toHaveBeenCalledWith("test-token", "conv-new");
    });
  });

  describe("conversational accessory mode switching UI (#259)", () => {
    it("updates dropdown to Exclude and shows AI reply when mode change to exclude completes", async () => {
      const user = userEvent.setup();
      apiMocks.fetchChatConversations.mockResolvedValue([]);
      apiMocks.streamChatResponse.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          _signal: unknown,
          onChunk: (chunk: string) => void,
          onConversationId: (id: string) => void
        ) => {
          onChunk("Got it — accessories excluded for future outfits.");
          onConversationId("conv-1");
        }
      );
      apiMocks.fetchChatConversation.mockResolvedValue({
        conversation: { id: "conv-1", accessoryMode: "exclude" },
        messages: [
          { id: "m1", role: "user", content: "no accessories" },
          { id: "m2", role: "assistant", content: "Got it — accessories excluded for future outfits." }
        ]
      });

      renderChat();
      const accessoryModeSelect = await screen.findByRole("combobox", { name: /accessories/i });
      expect(accessoryModeSelect).toHaveValue("auto");

      const textarea = screen.getByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "no accessories");
      await user.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(accessoryModeSelect).toHaveValue("exclude");
      });
      expect(screen.getByText(/accessories excluded/i)).toBeDefined();
    });

    it("shows add-back offer text in the message thread after AI switches to exclude", async () => {
      const user = userEvent.setup();
      apiMocks.fetchChatConversations.mockResolvedValue([]);
      apiMocks.streamChatResponse.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          _signal: unknown,
          _onChunk: unknown,
          onConversationId: (id: string) => void
        ) => {
          onConversationId("conv-1");
        }
      );
      apiMocks.fetchChatConversation.mockResolvedValue({
        conversation: { id: "conv-1", accessoryMode: "exclude" },
        messages: [
          { id: "m1", role: "user", content: "no accessories" },
          {
            id: "m2",
            role: "assistant",
            content: "Here are your outfits.\nWould you like me to add accessories to these outfits? Say 'yes, all', 'the second one', or 'no thanks'."
          }
        ]
      });

      renderChat();

      const textarea = await screen.findByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "no accessories");
      await user.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(screen.getByText(/Would you like me to add accessories/i)).toBeDefined();
      });
    });

    it("keeps dropdown unchanged and shows option prompt when AI responds to ambiguous phrase", async () => {
      const user = userEvent.setup();
      apiMocks.fetchChatConversations.mockResolvedValue([]);
      apiMocks.streamChatResponse.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          _signal: unknown,
          _onChunk: unknown,
          onConversationId: (id: string) => void
        ) => {
          onConversationId("conv-1");
        }
      );
      apiMocks.fetchChatConversation.mockResolvedValue({
        conversation: { id: "conv-1", accessoryMode: "auto" },
        messages: [
          { id: "m1", role: "user", content: "keep it minimal" },
          {
            id: "m2",
            role: "assistant",
            content: "Just to confirm — would you like me to (a) include accessories, (b) exclude accessories, or (c) let me decide? Reply with a, b, or c."
          }
        ]
      });

      renderChat();
      const accessoryModeSelect = await screen.findByRole("combobox", { name: /accessories/i });

      const textarea = screen.getByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "keep it minimal");
      await user.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(screen.getByText(/Just to confirm/i)).toBeDefined();
      });
      expect(accessoryModeSelect).toHaveValue("auto");
    });

    it("clears add-back offer and resets dropdown when switching away from a conversation with pending offer", async () => {
      const user = userEvent.setup();
      apiMocks.fetchChatConversations.mockResolvedValue([
        { id: "conv-exclude", title: "Exclude Chat", lastMessagePreview: "", updatedAt: new Date().toISOString() },
        { id: "conv-auto", title: "Auto Chat", lastMessagePreview: "", updatedAt: new Date().toISOString() }
      ]);
      apiMocks.fetchChatConversation.mockImplementation(async (_token: string, id: string) => {
        if (id === "conv-exclude") {
          return {
            conversation: { id: "conv-exclude", accessoryMode: "exclude" },
            messages: [
              { id: "m1", role: "user", content: "no accessories" },
              {
                id: "m2",
                role: "assistant",
                content: "Here are your outfits.\nWould you like me to add accessories to these outfits? Say 'yes, all', 'the second one', or 'no thanks'."
              }
            ]
          };
        }
        return {
          conversation: { id: "conv-auto", accessoryMode: "auto" },
          messages: [{ id: "m3", role: "assistant", content: "Hello! How can I help?" }]
        };
      });

      renderChat();

      await screen.findByText(/Would you like me to add accessories/i);
      const accessoryModeSelect = screen.getByRole("combobox", { name: /accessories/i });
      expect(accessoryModeSelect).toHaveValue("exclude");

      await user.click(screen.getByText("Auto Chat"));

      await waitFor(() => {
        expect(screen.queryByText(/Would you like me to add accessories/i)).toBeNull();
      });
      expect(accessoryModeSelect).toHaveValue("auto");
      expect(screen.getByText(/Hello! How can I help/i)).toBeDefined();
    });

    it("shows refusal in chat and keeps dropdown unchanged when wardrobe has no accessories during conversational include request", async () => {
      const user = userEvent.setup();
      apiMocks.fetchChatConversations.mockResolvedValue([]);
      apiMocks.streamChatResponse.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          _signal: unknown,
          _onChunk: unknown,
          onConversationId: (id: string) => void
        ) => {
          onConversationId("conv-1");
        }
      );
      apiMocks.fetchChatConversation.mockResolvedValue({
        conversation: { id: "conv-1", accessoryMode: "auto" },
        messages: [
          { id: "m1", role: "user", content: "add accessories to my outfits" },
          {
            id: "m2",
            role: "assistant",
            content: "You have no accessories in your wardrobe. Please upload some first — otherwise I can't generate recommendations with accessories."
          }
        ]
      });

      renderChat();
      const accessoryModeSelect = await screen.findByRole("combobox", { name: /accessories/i });
      expect(accessoryModeSelect).toHaveValue("auto");

      const textarea = screen.getByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "add accessories to my outfits");
      await user.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(screen.getByText(/no accessories in your wardrobe/i)).toBeDefined();
      });
      expect(accessoryModeSelect).toHaveValue("auto");
    });
  });

  describe("outfit card count (#267, #270)", () => {
    it.each([1, 2, 3, 4, 5])(
      "renders exactly %i outfit card(s) when assistant message has that many recommendations",
      async (count) => {
        const now = new Date().toISOString();
        const recommendations = Array.from({ length: count }, (_, i) => ({
          id: `rec-${i + 1}`,
          userId: "u1",
          outfitName: `Outfit ${i + 1}`,
          reason: `Reason ${i + 1}`,
          items: [{ id: `item-${i + 1}`, name: `Item ${i + 1}` }],
          occasions: [],
          generation: null,
          vote: null,
          conversationId: "conv-1",
          messageId: "m1",
          createdAt: now,
          updatedAt: now
        }));

        apiMocks.fetchChatConversations.mockResolvedValue([
          { id: "conv-1", title: "Outfit Suggestions", lastMessagePreview: "", updatedAt: now }
        ]);
        apiMocks.fetchChatConversation.mockResolvedValue({
          conversation: { id: "conv-1", accessoryMode: "auto" },
          messages: [
            {
              id: "m1",
              role: "assistant",
              content: `Here are ${count} outfit${count === 1 ? "" : "s"}.`,
              recommendationIds: recommendations.map((r) => r.id),
              recommendations
            }
          ]
        });

        renderChat();

        for (const rec of recommendations) {
          await screen.findByText(rec.outfitName);
        }
      }
    );
  });

  describe("streaming outfit cards (#269, #270)", () => {
    it("renders the first streamed outfit card before the stream completes", async () => {
      const user = userEvent.setup();
      let capturedOnOutfit: ((outfit: unknown) => void) | undefined;
      let resolveStream: (() => void) | undefined;

      apiMocks.streamChatResponse.mockImplementation(
        (
          _token: string,
          _payload: unknown,
          _signal: AbortSignal,
          _onChunk: (chunk: string) => void,
          _onConversationId: (id: string) => void,
          onOutfit: (outfit: unknown) => void
        ) => {
          capturedOnOutfit = onOutfit;
          return new Promise<void>((resolve) => {
            resolveStream = resolve;
          });
        }
      );

      renderChat();

      const textarea = await screen.findByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "Suggest a couple of outfits");
      await user.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(capturedOnOutfit).toBeDefined();
      });

      const now = new Date().toISOString();
      const makeStreamedOutfit = (n: number) => ({
        id: `stream-rec-${n}`,
        userId: "u1",
        outfitName: `Streamed Outfit ${n}`,
        reason: `Streamed reason ${n}`,
        items: [{ id: `stream-item-${n}`, name: `Streamed Item ${n}` }],
        occasions: [],
        generation: null,
        vote: null,
        conversationId: "conv-1",
        messageId: "streaming-msg",
        createdAt: now,
        updatedAt: now
      });

      // Emit first outfit; it must render while the stream is still pending
      capturedOnOutfit!(makeStreamedOutfit(1));
      await screen.findByText("Streamed Outfit 1");

      // Second outfit is emitted later in the same stream; it also appears without
      // waiting for the stream to finish
      capturedOnOutfit!(makeStreamedOutfit(2));
      await screen.findByText("Streamed Outfit 2");

      // Now resolve the stream — send button should come back
      resolveStream!();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /send/i })).toBeDefined();
      });
    });
  });

  describe("outfit cards", () => {
    it("renders outfit cards when assistant message has recommendations", async () => {
      apiMocks.fetchChatConversations.mockResolvedValue([
        { id: "conv-1", title: "Outfit Suggestions", lastMessagePreview: "", updatedAt: new Date().toISOString() }
      ]);
      apiMocks.fetchChatConversation.mockResolvedValue({
        conversation: { id: "conv-1", accessoryMode: "auto" },
        messages: [
          {
            id: "m1",
            role: "assistant",
            content: "Here are your outfits.",
            recommendationIds: ["rec-1", "rec-2", "rec-3"],
            recommendations: [
              { id: "rec-1", userId: "u1", outfitName: "Casual Friday", reason: "Comfortable and stylish.", items: [{ id: "item-1", name: "Blue Tee" }], occasions: [], generation: null, vote: null, conversationId: "conv-1", messageId: "m1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
              { id: "rec-2", userId: "u1", outfitName: "Office Look", reason: "Professional.", items: [{ id: "item-2", name: "Black Blazer" }], occasions: [], generation: null, vote: null, conversationId: "conv-1", messageId: "m1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
              { id: "rec-3", userId: "u1", outfitName: "Weekend Stroll", reason: "Relaxed.", items: [{ id: "item-3", name: "White Sneakers" }], occasions: [], generation: null, vote: null, conversationId: "conv-1", messageId: "m1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
            ]
          }
        ]
      });

      renderChat();

      await screen.findByText("Casual Friday");
      expect(screen.getByText("Office Look")).toBeDefined();
      expect(screen.getByText("Weekend Stroll")).toBeDefined();
    });
  });
});
