# Product Requirement Document

## Overview

### Problem Statement

People own more clothes than they can keep track of, and choosing what to wear — especially for specific occasions or weather conditions — is a daily friction point. When shopping for new items, it's hard to visualize how they'll look on your body or whether they'll work with what you already own.

### Proposed Solution

WearWise is a personal cloud clothing library with an AI-powered outfit recommendation agent. Users upload their clothing items and a body photo; the agent recommends outfits based on weather, occasion, and personal preferences, and generates virtual try-on images showing how each outfit looks on them.

### Target Users

People who want help organizing their wardrobe and making outfit decisions — particularly those who find it difficult to visualize combinations or want weather-aware, occasion-specific recommendations without manually browsing their closet.

### AI Component

- **OpenAI gpt-5-mini** handles chat reasoning: it interprets the user's natural language request, queries weather context via tool use, and orchestrates the outfit recommendation flow.
- **Gemini** handles outfit logic and virtual try-on image generation: it analyzes the user's cloud closet, selects three distinct outfit combinations, writes style notes, and composites a realistic image of the user wearing each outfit.
- **Google Cloud Vision SafeSearch** reviews uploaded images for explicit or offensive content before storage.

### Similar Existing Solutions

- **Stylebook** — a digital closet app that lets users catalog clothes and plan outfits, but has no AI recommendation or virtual try-on.
- **YesPlz** — an AI fashion discovery tool focused on shopping, not an existing wardrobe.
- **Combyne** — social outfit builder without personalized AI recommendations or try-on visualization.

WearWise differs by combining an existing wardrobe library, AI-driven recommendations, and photorealistic try-on in a single workflow.

---

## Requirements

### Functional Requirements

#### Essential (Must-Have)

- Users can sign in with Google OAuth and create a personal account/profile.
- Users can upload, replace, and delete their profile images (face and full-body) along with their height and weight.
- Users can upload, replace, and delete images of clothing items.
- The system analyzes uploaded clothing images and extracts features: name, category (tops, pants, shoes, etc.), tags (fabric, color, length), and description.
- Users can edit the extracted features (name, category, tags, description) for any clothing item.
- Users can communicate clothing needs to the agent via chat and receive outfit recommendations.
- The system invokes a weather query tool to get current conditions and incorporates them into recommendations.
- The system recommends three distinct outfits per request (no duplicate combinations) based on the user's cloud closet, stated needs, and weather.
- The system generates realistic virtual try-on images showing each recommended outfit on the user's body.
- Users can vote on recommended outfits to express preferences.
- The system summarizes user preferences from votes to give more personalized recommendations in future sessions.
- Users can upload an online product image, receive outfit recommendations incorporating the new item, and request a virtual try-on.
- Users can permanently delete their accounts.
- The system stores clothing features in a per-user private database accessible to the user and the AI agent.
- The system stores chat sessions and try-on images in a history page where users can view past results.
- Users can replace and delete their profile photos after initial upload.
- Users can choose whether to include accessories in recommendations.

#### Non-Essential (Nice-to-Have)

- Users can select specific items from the cloud closet and request recommendations based only on those items.
- The system recognizes and recommends accessories (jewelry, hats, bags).

#### Out of Scope (Won't Have)

- Social network features for posting or sharing outfits publicly.
- End-to-end e-commerce workflow (purchase, payment, order tracking, returns).
- Health or body advice based on uploaded photos.

---

### Non-Functional Requirements

#### Performance

- Text recommendation results return within 45 seconds.
- Try-on image generation completes within ~90 seconds per request.
- Cloud closet browsing and search responds within ~2 seconds for common operations.

#### Security

- Sessions are signed with HMAC-SHA256; uploaded images rely on Cloudflare R2's at-rest encryption.
- A JWT is generated on login and used for request validation on all API calls.
- User accounts and sessions are managed through Google OAuth.
- API keys are stored server-side and never exposed to the client.
- Uploaded face/body photos are screened for inappropriate content using Google Cloud Vision SafeSearch before being processed. Self-attested age verification was intentionally scoped out, since a checkbox cannot meaningfully verify a user's real age; content-based screening provides stronger and more verifiable protection.

#### Privacy

- Users have full control over their data, including the ability to delete uploaded content and their accounts.
- Only data necessary for the cloud closet and recommendations is stored: account and login information, profile information (height, weight, face/body photos), cloud closet content (clothing images and extracted attributes), user feedback on outfits, and virtual try-on results.
- OpenAI API, Google Gemini API (paid tier), and Cloud Vision API do not use submitted content, including images, to train or improve their models (see Appendix).

#### Usability

- Users can complete sign-in and reach the chat screen in ≤ 3 actions.
- The application is accessible on both desktop and mobile.

---

### Technology Stack

- **Frontend:** TypeScript, React
- **Backend:** TypeScript, Express.js, Node.js
- **Database:** MongoDB
- **Image Storage:** Cloudflare R2
- **Auth:** Google OAuth 2.0
- **Consent Review:** Google Cloud Vision – SafeSearch
- **Weather API:** OpenWeather
- **AI Services:** OpenAI gpt-5-mini (chat reasoning), Gemini (outfit logic, style notes, virtual try-on image generation)
- **Deployment:** Firebase Hosting (frontend), Render (backend API and long-running image generation workers)
- **Testing:** Vitest

---

## Product Roadmap

### Iteration 1

**Dates:** Week 6–7

**Goal:** Build the foundational workflow — user onboarding, wardrobe upload, and basic chat interface.

**Must-Have Features:**
- Google OAuth login
- User profile creation with face/full-body photos, height, and weight
- Clothing image upload with AI-powered feature extraction (name, category, description)
- Basic chat interface for users to communicate clothing needs
- Virtual try-on image generation API (initial integration)

### Iteration 2

**Dates:** Week 8–10

**Status:** Complete — deployed at https://wearwise-cs423.web.app/

**Goal:** Deliver the core recommendation workflow end-to-end.

**Must-Have Features:**
- Replace and delete clothing images; edit clothing metadata
- Mock test data importable by users
- Weather query tool integration for context-aware recommendations
- Three distinct outfit recommendations per request (no duplicate combinations)
- Virtual try-on images generated for each recommended outfit

**Nice-to-Have Features:**
- Users can select specific clothes from the closet and request recommendations based only on those items

### Iteration 3

**Dates:** Week 11–12

**Goal:** Personalization and feedback loop.

**Must-Have Features:**
- LLM summarizes weather, occasion, and user attributes to improve recommendations
- Users can vote on recommended outfits to express preferences
- Users can choose whether to include accessories in recommendations
- Chat sessions and try-on images stored in a user-accessible history page

### Iteration 4

**Dates:** Week 13–14

**Goal:** User experience expansion and personalization depth.

**Must-Have Features:**
- System summarizes user preferences and votes to deliver more personalized future recommendations
- Users can upload an online product image, receive outfit recommendations incorporating the new item, and request a virtual try-on

**Nice-to-Have Features:**
- Users can permanently delete their accounts

---

## Appendix

- Gemini API Additional Terms of Service: https://ai.google.dev/gemini-api/docs/zdr
- Cloud Vision API — Data Usage FAQ: https://docs.cloud.google.com/vision/docs/data-usage
