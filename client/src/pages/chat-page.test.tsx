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

const apiMocks = vi.hoisted(() => ({
  fetchChatConversations: vi.fn(),
  fetchChatConversation: vi.fn(),
  deleteChatConversation: vi.fn(),
  fetchClosetItems: vi.fn(),
  streamChatResponse: vi.fn(),
  generateOutfit: vi.fn()
}));

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

    it("hides quick prompts once input has text", async () => {
      const user = userEvent.setup();
      renderChat();

      const textarea = await screen.findByPlaceholderText(/tell me what you want/i);
      await user.type(textarea, "what should I wear");

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
        id: "conv-1",
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
        id: "conv-1",
        messages: [{ id: "m1", role: "user", content: "Hello" }]
      });

      renderChat();

      await screen.findByText("Old Chat");
      await user.click(screen.getByRole("button", { name: /new chat/i }));

      await screen.findByText(/tell me the weather/i);
    });
  });

  describe("outfit cards", () => {
    it("renders outfit cards when assistant message has recommendations", async () => {
      apiMocks.fetchChatConversations.mockResolvedValue([
        { id: "conv-1", title: "Outfit Suggestions", lastMessagePreview: "", updatedAt: new Date().toISOString() }
      ]);
      apiMocks.fetchChatConversation.mockResolvedValue({
        id: "conv-1",
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
