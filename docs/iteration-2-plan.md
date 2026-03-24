# **Iteration 2 Plan**

**Dates:** Week 8–10 (due 2026-03-29)

## **Requirements & Acceptance Criteria** **& Task Breakdown**

### **R1. Weather-Aware Outfit Recommendations**

**Description:** The chat agent fetches real-time weather for the user's location and factors it into outfit suggestions.

**Task Breakdown:**

- Configure the OpenWeather API.
- Build a weather tool for LLM to trigger.
- Connect the chatting with the tool.

**Acceptance Criteria:**

- The weather tool is exposed to and callable by the chat agent.
- Weather query errors (bad city, API failure) are handled gracefully and do not crash the chat flow.
- When a user asks for weather-related questions, the agent invokes the weather tool and incorporates the result into its response.

### **R2. AI Outfit Recommendation from Personal Wardrobe**

**Description:** Currently, chat AI has no knowledge of the user's wardrobe or profile. This feature enables the AI to recommend exactly 3 distinct, non-duplicate outfit combinations per request, drawn from the user's actual clothing items, tailored to their style preferences and stated occasion/needs.

**Task Breakdown:**

- Inject user wardrobe + profile as system message into `POST /api/chat` 
- Add structured 3-outfit JSON system prompt to chat service 
- Parse outfit JSON in chat UI and render as 3 outfit cards with thumbnails 
- Write tests  `ClosetRepository` and `UserRepository`; call the `POST /api/chat` handler and verify the system message contains wardrobe items (ready only), user profile, and the 3-outfit JSON schema instruction

**Acceptance Criteria:**

- The chat endpoint injects the user's full closet (name, category, tags, description) into the AI context
- The chat endpoint injects the user's profile (styleNote, heightCm, weightKg) into the AI context
- The AI returns exactly 3 distinct outfit combinations — individual items may appear across multiple outfits, but no two outfits share the exact same set of items
- Each outfit contains at most one item per category (e.g., no two tops, no two bottoms in a single outfit)
- Each outfit includes the clothing item IDs from the user's closet
- The chat UI parses and displays the 3 outfits as structured cards (not raw text)

### **R3. Try-On Image Generation for Recommended Outfits**

**Description:** After the AI recommends outfits, users should be able to generate a try-on image for any recommended outfit. The system uses the user's full-body photo and the clothing item images to produce a realistic try-on via Gemini image generation. The backend endpoint is already implemented; this feature wires it into the recommendation flow.

**Task Breakdown:**

- Add generateOutfit client function to client/src/lib/api.ts 
- Wire "Generate Try-On" button on outfit cards and display the returned image URL in the chat UI 
- Write tests for generateOutfit() client function: correct request shape, `Authorization` header present, error thrown on non-2xx response 

**Acceptance Criteria:**

- Each recommended outfit card has a 'Generate Try-On' button
- Clicking the button calls `POST /api/generate/outfit` with the outfit's item IDs
- A loading state is shown while the image is being generated
- The generated try-on image is displayed inline in the chat UI
- If the user has no full-body photo, a clear error message is shown

### **R4. Wardrobe Selection, Outfit Recommendation, and Try-On Image Generation**

**Description:** Users can select specific clothes from the cloud closet and request outfit recommendations based only on the selected items. After receiving a recommendation, users can generate a virtual try-on image showing the complete outfit on their body.

**Task Breakdown:**

- Add wardrobe selection mode UI with per-category constraint 
- Implement `POST /api/closet/recommend` endpoint with Gemini structured output
- Build outfit recommendation result panel on wardrobe page 
- Select clothes and get AI outfit completion recommendation 
- Add `generateOutfit` API client function to `api.ts` 
- Add Generate Try-On button and image display to wardrobe recommendation panel 
- Generate outfit try-on image from recommended outfit 

**Acceptance Criteria:**

- The wardrobe page has a selection mode where users can toggle individual items and see a per-category constraint (at most N−1 categories may be selected at once).
- If a user attempts to select items from all categories simultaneously, the action is blocked with a clear message. 
- A "Get Recommendation" button sends the selected item IDs to `POST /api/closet/recommend` and displays the structured result. 
- The recommendation result panel shows a style note, each outfit item with its image, and badges indicating whether each piece was user-picked or AI-suggested. (#48 ✓)
- A "Generate Try-On Image" button appears at the bottom of the recommendation panel once a recommendation is loaded.
- Clicking the button calls `generateOutfit()` from `api.ts` with the combined item IDs (user-selected + AI-recommended) and shows a loading spinner during generation.
- The button is disabled while generation is in progress to prevent duplicate requests.
- On success, the generated try-on image is displayed inline below the recommendation panel.
- If the user has no full-body photo (HTTP 422), the message "Please upload a full-body photo in your profile first" is shown and no API call is made.
- On other generation failures, a descriptive error message is shown and the button is re-enabled.
- The generated image is cleared when the user exits selection mode or navigates away (ephemeral React state).

### **R5. Closet Item Management (Edit / Delete / Replace)** 

**Description:**  Users can manage their uploaded clothing items by deleting unwanted items, replacing images with new photos, and editing AI-generated metadata (name, category, tags, description).

**Task Breakdown:**

Backend: Add DELETE, PUT /image, PATCH endpoints for closet items 

Frontend: Add delete and replace image controls on wardrobe and detail pages

Frontend: Add inline metadata editing UI on detail page

**Acceptance Criteria:**

- Users can delete a clothing item from the wardrobe page or detail page
- Users can replace a clothing item's image, which triggers re-analysis
- Users can edit name, category, tags, and description on the detail page
- Deleted items are removed from both the database and image storage

### **R6. Clothes Sample Data Input**

**Description:** Users can import sample data into their wardrobe without uploading their own clothes.

**Task Breakdown:**

- Collect clothes sample data
- Create a button to import sample data to the current user's wardrobe.

**Acceptance Criteria:**

- The sample data should be able to be imported into the current user's wardrobe.

## **Coordination & Design Decisions**

- The recommendation system will use structured JSON output so both the chat UI and wardrobe page can render exactly three distinct outfits consistently. Weather data will be retrieved through a backend weather tool and injected into the recommendation context together with the user profile and wardrobe metadata. For selected-item recommendations, user-picked clothes will act as constraints.
- Try-on generation will be a separate step after recommendation rather than part of the recommendation request. This keeps the recommendation flow faster and lets users choose when to generate images. Generated try-on images will be shown inline in the UI and kept only in temporary frontend state for this iteration.
- For clothing management, backend endpoints will handle delete, replace-image, and metadata updates, while frontend pages will show clear loading, success, and error states. The team should coordinate any schema or API changes early so frontend and backend work can progress in parallel without conflicts.

**Ownership**

- `@FengqiHu`: Weather query tool and chat integration (#29, #30, #31, #32, #33, #58).
- `@hermit-yoshino-xl`: AI outfit recommendation (#34, #36, #37, #39)
- `@jiruidai`: Try-on image generation on wardrobe page (#44, #49, #50), wardrobe selection and recommendation panel (#43, #45, #46,#48).
- `@z8ri`: Closet item delete/replace (#51, #52, #53, #78), edit metadata (#55)
- `@Nanshengbeisheng`: Try-on image generation based on recommended outfits (#35, #38, #40, #94), test dataset collection (#56).

**Dependency order**

- Wardrobe + profile context injection (#36) must land before chat-based outfit cards (#37, #39) work end-to-end.
- `generateOutfit` client function (#38, #49) must exist before try-on display (#40, #50) can be wired up.
- Weather tool (#31) must be callable by the agent (#29) before chat integration (#58) is testable.