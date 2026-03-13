# WearWise Docs

Project-level documents for planning, process, and decision-making. These are living documents — update them as the project evolves.

---

# Team Agreement

## Members Information

| **Full name** | **Preferred name** | **JHU Email**   | **GitHub Username** | **Cell phone** |
| ------------- | ------------------ | --------------- | ------------------- | -------------- |
| Fengqi Hu     | Louis Hu           | fhu14@jh.edu    | FengqiHu            | 410-805-1208   |
| Zeli Ma       | Zeli Ma            | zma56@jh.edu    | hermit-yoshino-xl   | 443-418-9697   |
| Xinyuan Qi    | Xinyuan Qi         | xqi20@jh.edu    | nanshengbeisheng    | 443-416-2872   |
| Jirui Dai     | Jirui Dai          | jdai27@jh.edu   | jiruidai            | 443-835-5175   |
| Yujia Zhang   | Yujia Zhang        | yzhan876@jh.edu | z8ri                | 410-500-6235   |

## Team Values

- Each team member is responsible and accountable for upholding our collaboration values as we work together to improve teamwork and communication. We will hold each other accountable when someone does not act in accordance with this agreement.
- All team members are expected to attend meetings and classes on time and come prepared:
  Be on time. Come with updates (what's done / what's next / blockers) shared in the meeting thread before the meeting starts.
- Task ownership must be explicit and trackable: If a deadline is at risk, the owner must notify the team in Slack at least 12 hours before the due time with (1) what's blocked, (2) what help is needed.
- We share responsibility for the quality of deliverables: No "throwing work over the wall." All changes should be reviewable (clear commit/PR description + how to test/run). Important deliverables (PRs, slides, demos, docs) should be reviewed by at least one teammate when time allows.
- We disagree productively using specific evidence: When proposing an option, explain the tradeoff (cost/benefit, timeline impact, risk). If we can't reach consensus within 1 hour, the meeting facilitator will call for a decision (vote or assign a decision owner).
- We communicate respectfully with observable behaviors: Use non-judgmental, actionable feedback, and listen fully before responding; avoid interrupting.
- We address conflicts early and at the right level: Resolve issues directly with the involved person(s) first (in Slack or quick one-to-one). If unresolved within 72 hours or repeatedly impacts progress, escalate to the team and then to CA/instructor if needed, with a brief written summary.

## Team Communication

- At least conduct a meeting per week. This can be face-to-face or via Zoom.
- Developers will meet every other day (quick sync) to review progress, plans, and blockers.
- Everyone is expected to actively participate in team meetings. If unable to attend a meeting, advance notice should be given in **course Slack**. If a team member misses a meeting, they should follow up within **12 hours** by checking the meeting notes / Slack summary and confirming any pending tasks.
- At the beginning of each iteration, an availability schedule will be provided in **course Slack**. Team members may be available for deployment/delivery outside regular business hours or on weekends when required by milestones.
- **Course Slack will be the primary communication tool**:
  - All project decisions, task assignments, progress updates, and blockers must be posted in Slack (so information is searchable and not lost).
  - Slack is also the platform to communicate with professors and TAs.
- **WeChat / texting via cell phone will be used only for urgent correspondence** (e.g., last-minute meeting changes, emergencies). Any decision made outside Slack must be summarized back in Slack within **2 hour**.
- A response in **Slack** is expected within **12 hours** (at minimum 👀 to acknowledge). If a response is not received in time, the person responsible will buy coffee for everyone or send a red pocket to everyone 😄
  - Use 👍 / OK to indicate agreement or acknowledgment.
  - Engage in a conversation in a dedicated thread (click "Reply to thread") for questions, comments, objections, etc.
  - Use ✅ to show that action has been taken / resolved in response to a thread.
  - Use 👀 to indicate that you have seen the message and will follow up later (add an ETA if possible).
- Any issues that may prevent the completion of assigned tasks should be proactively communicated in Slack with: the blocker, its impact on timeline, what help is needed, and the next update time.

---

# Product Requirements

## Functional Requirements

### **Must-Have**

* Users can create a personal account/profile.

* Users can upload, replace, and delete their own profile images (face and full-body) and their height and weight.

* Users can upload and delete images of clothing items.

* The system analyzes uploaded clothing images and extracts clothing features, generating cloth's name, category (tops, pants, shoes, etc.), tag (fabric, color, long/short), and description.

* Users can modify the features (including name, category, tag, and description) for their clothes.

* Users can communicate their clothing needs to the agent and ask for clothing recommendations.

* Users can vote some outfits from recommendation results as their preferences.

* Users can permanently delete their accounts.

* The system stores extracted clothing features (category, tag, description) in a per-user private database which can be used by users and LLMs to filter and search.

* The system can invoke weather query tool to get the weather condition for making the recommendation.

* The system generates realistic images showing how each recommended outfit would look on the user's body (virtual try-on visualization). The image must basicly match the user's body shape and appearance.

* The system recommends three outfits per request based on the user's existing cloud closet. Each recommended outfit must include the new item plus compatible items from the user's cloud closet.

* The system can summeriuze user's preferences to give more personalized recommendations in future sessions.

* Users can upload an online product image and request a visual try-on of that item on themselves. The system can recommand possible combinations with the user's existing cloud closet. This function is triggered by a user request, and the system will provide three recommendations based on the categories and tags of these clothes.

### Nice-to-Have

* Users can select clothes from the cloud closet to have the agent make recommendations instead of relying on all the clothes in the entire cloud closet.

* The system can recognize and recommend accessories (jewjlry,hats,bags).This stays nice-to-have because accessory-heavy image parsing adds extra visual attributes and increases inference time,which may slow down the user experience.

* The system will automatically detect whether user-uploaded images contain pornography or nudity, violence, gore, offensive content and refuse to upload.

### Won't Have

* Build a social network for users to post content.

* Establish the workflow for end-to-end ecommerce including purchase, payment, order tracking, and returns.

* Give any advice on health care such as weight loss and body shaping based on the uploaded body photos

## Non-Functional Requirements

### **Performance**

* Text recommendation result will return within 45 seconds.

* Try-on image generation completes within an acceptable waiting window (target: within ~90 seconds per request, mainly decided by LLM).

* Cloud closet browsing/search stays responsive (target: within ~2 seconds for common operations).

### **Security**

* User's username, gmail will be encrypted by SHA256, and uploaded images need to be encrypted by AES. Once the user logs in, the system will generate a JWT as a credential for request validation.

* User accounts and sessions are handled with the Google portal.

* User photos and cloud closet assets are protected in database and transmission.

* API keys will not be exposed to users and will be stored securely.

* We will have age verification and explicit consent gating before any face/body upload or try-on

### **Privacy**

* Users have full control of their data including deleting the uploaded information and their accounts.

* Only the data needed for cloud closet and recommendations will be stored. It includes account and login information(via Google OAuth), profile information (height, weight, and user-uploaded face/full-body photos), cloud closet content (uploaded clothing images and the extracted/editable clothing attributes, e.g., category, tags, description), user's feedback on recommended outfits, virtual try-on data(user-provided product images and generated try-on results).

* Our AI providers (Google Gemini API Paid Tier and Cloud Vision API) state that user content, including uploaded images, is not used to train or improve their models (specific links are in the appendix).

### **Usability**

* Users can complete account sign-in and reach the chat screen in ≤ 3 user actions, then they can chat and interact with agent.

* The interaction page can be accessed on both desktop and mobile.

## Technology Stack

* **Frontend**: TypeScript, React

* **Backend**: TypeScript, Vercel

* **Database**: MongoDB

* **Image Storage**: Cloudflare R2

* **Auth:** Google OAuth 2.0

* **Consent Review:** Google Cloud Vision – SafeSearch

* **Weather API**: OpenWeather (weather query)

* **AI Services**: Gemini (reasoning for recommendation), Nano Banana (image generation)

* **Deployment:** Firebase

* **Testing:** Vitest

## Appendix

Gemini API Additional Terms of Service: https://ai.google.dev/gemini-api/docs/zdr

Cloud Vision API — Data Usage FAQ: https://docs.cloud.google.com/vision/docs/data-usage

---

# Project Roadmap

## Iteration 1

**Dates:** Week 5-6

**Goal:** Build the foundational workflow

**Must-to-Have Features**

- Google OAuth login
- Users can create personal accounts/profiles with their own images (face and full-body), height and weight.
- Users can upload images of clothing items.
- Users can communicate their clothing needs to the system (chatting).
- Create try-on image generation api.
- The system analyzes uploaded clothing images and extracts clothing features, generating cloth's name, category (tops, pants, shoes, etc.), and description.

## Iteration 2

**Dates:** Week 7-8

**Goal:** Deliver the core workflow of clothing recommendations

**Must-to-Have Features**

- Users can replace and delete images of clothing items.
- The system can invoke a weather query tool to get the weather conditions.
- The system recommends three distinct outfits (with no duplicate outfit combinations) per request based on the cloud closet, users' needs and weather.
- The system generates try-on images based on the recommended outfits and profile image.

**Nice-to-Have Features:**

- Users can select specific clothes from the cloud closet and request outfit recommendations based only on the selected items.

## Iteration 3

**Dates:** Week 10-11

**Goal:** Personalization and feedback loop

**Must-to-Have Features**

- Users can replace and delete their profile information (images, weight, and height).
- Users can modify the features (including name, category, tag, and description) of their clothes.
- Users can vote for some outfits from the recommendation results.
- The system can summeriuze user's preferences and votes to give more personalized recommendations in future sessions.

**Nice-to-Have Features**

- The system can recognize and recommend accessories (jewelry, hats, bags) with outfits and include them as optional add-ons in outfit recommendations.

## Iteration 4

**Dates:** Week 12-13

**Goal:** User experience expansion

**Must-to-Have Features**

- The system can store chat sessions and generate try-on images in a user-accessible history page where users can view past results.
- Users can upload an online product image, receive outfit recommendations that incorporate the new item, and request a visual try-on.

**Nice-to-Have Features**

- Users can permanently delete their accounts.
- The system will automatically detect illegal and offensive content.

---

# Iteration 1 Plan

**Dates:** Week 5-6

## Requirements & Acceptance Criteria

### R1. Google OAuth Login and Session Setup

**Description:** Users can sign in with Google and access authenticated app features with a valid session.

- **Acceptance Criteria:**
  - [x] Unauthenticated users can start Google OAuth and complete sign-in successfully.
  - [x] After successful login, users are redirected to the app and an authenticated session/JWT is established.
  - [x] Protected API routes reject unauthenticated requests with `401`.
  - [x] Sign-out removes session state and returns the user to a public page.

### R2. Personal Profile Creation (Images + Height/Weight)

**Description:** Users can create and save a personal profile with face image, full-body image, height, and weight.

- **Acceptance Criteria:**
  - [x] A logged-in user can submit height and weight with validation (required, numeric, positive values).
  - [x] A logged-in user can upload one face image and one full-body image for their profile.
  - [x] Profile data is persisted and can be retrieved on page refresh/re-login.
  - [x] Profile records are user-scoped; one user cannot read another user's profile.

### R3. Clothing Item Image Upload

**Description:** Users can upload clothing item images into their private cloud closet.

- **Acceptance Criteria:**
  - [x] A logged-in user can upload a clothing image from the UI.
  - [x] Uploaded item records are stored per user and visible in that user's closet list.
  - [x] Invalid file types or oversized files are rejected with a clear error.
  - [x] Users only see their own uploaded clothing items.

### R4. Clothing Attribute Extraction Pipeline

**Description:** After upload, the system extracts clothing metadata: name, category, tags, and description.

- **Acceptance Criteria:**
  - [ ] New uploads trigger analysis automatically (sync or async worker).
  - [ ] Extracted fields include `name`, `category`, `tags`, and `description`.
  - [ ] Extraction output is persisted and queryable from closet item detail/list APIs.
  - [ ] Failed analysis is marked with status and an error reason for retry/debugging.

### R5. Clothing Need Input (User-to-Agent Request Capture)

**Description:** Users can describe current clothing needs to the system through a chat-like input flow.

- **Acceptance Criteria:**
  - [ ] Authenticated users can submit a natural-language clothing request.
  - [ ] The request is saved with user ID and timestamp.
  - [ ] The system returns a structured acknowledgement payload (for example: occasion/weather/style intent fields).
  - [ ] Submission errors are surfaced to users with actionable messages.

## Coordination & Design Decisions

- **Architecture scope for Iteration 1**
  - React (frontend) + TypeScript server APIs on Vercel.
  - MongoDB for user/profile/closet/request data.
  - Cloudflare R2 for profile and clothing image storage.
  - Gemini endpoint for clothing attribute extraction.

- **Data contracts (initial schema direction)**
  - `User`: `id`, `googleSubHash`, `emailHash`, `createdAt`.
  - `Profile`: `userId`, `height`, `weight`, `faceImageUrl`, `bodyImageUrl`, `updatedAt`.
  - `ClosetItem`: `id`, `userId`, `imageUrl`, `analysisStatus`, `name`, `category`, `tags[]`, `description`, `createdAt`.
  - `NeedRequest`: `id`, `userId`, `rawText`, `parsedIntent`, `createdAt`.

- **API contracts to lock before implementation**
  - `POST /api/auth/google/callback`: finish login and return session token.
  - `GET /api/profile`, `PUT /api/profile`: read/update profile data.
  - `POST /api/profile/images`: upload profile images.
  - `POST /api/closet/items`, `GET /api/closet/items`: upload/list clothing items.
  - `POST /api/closet/items/:id/analyze` (internal trigger): run extraction.
  - `POST /api/needs`: submit user clothing-need requests.
  - `POST /api/generate/outfit`: generate try-on images.
  
- **Ownership**
  - `@FengqiHu`: auth/session architecture and sign-off, chatting feature including frontend and backend. 
    Frontend: My Wardrobe, Edit profile, Welcome Page (Log in), Upload Clothes
  - `@hermit-yoshino-xl`: issue#21, finishing the picture generation function
      issue#25, finishing linking the database to the cloud MongoDB.
  - `@nanshengbeisheng`: uploading headshot, fullbody, and avatar image in the profile page and built the pipeline of uploading images to Cloudflare R2.
  - `@jiruidai`: Implemented the AI-powered clothing analysis pipeline: backend Gemini integration with structured output, MongoDB persistence for extraction results and error handling, and removed the manual category selector in favor of automatic classification.
  - `@z8ri`: Implemented the end-to-end clothing image upload pipeline: backend presigned URL endpoint with MongoDB persistence, and frontend batch upload with preview and live wardrobe listing.

- **Dependency order**
  - Complete auth/session first (R1), then profile/closet endpoints (R2/R3).
  - Enable extraction after closet upload path is stable (R4 depends on R3).
  - Need-input flow depends on auth middleware and shared request logging (R5 depends on R1).

