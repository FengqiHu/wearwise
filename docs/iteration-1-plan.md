# Iteration 1 Plan

**Dates:** Week 5-6

## Requirements & Acceptance Criteria

### R1. Google OAuth Login and Session Setup

**Description:** Users can sign in with Google and access authenticated app features with a valid session.

- **Acceptance Criteria:**
  - [ ] Unauthenticated users can start Google OAuth and complete sign-in successfully.
  - [ ] After successful login, users are redirected to the app and an authenticated session/JWT is established.
  - [ ] Protected API routes reject unauthenticated requests with `401`.
  - [ ] Sign-out removes session state and returns the user to a public page.

### R2. Personal Profile Creation (Images + Height/Weight)

**Description:** Users can create and save a personal profile with face image, full-body image, height, and weight.

- **Acceptance Criteria:**
  - [ ] A logged-in user can submit height and weight with validation (required, numeric, positive values).
  - [ ] A logged-in user can upload one face image and one full-body image for their profile.
  - [ ] Profile data is persisted and can be retrieved on page refresh/re-login.
  - [ ] Profile records are user-scoped; one user cannot read another user's profile.

### R3. Clothing Item Image Upload

**Description:** Users can upload clothing item images into their private cloud closet.

- **Acceptance Criteria:**
  - [ ] A logged-in user can upload a clothing image from the UI.
  - [ ] Uploaded item records are stored per user and visible in that user's closet list.
  - [ ] Invalid file types or oversized files are rejected with a clear error.
  - [ ] Users only see their own uploaded clothing items.

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

- **Ownership and cross-team coordination**
  - `@FengqiHu`: auth/session architecture, backend guardrails, integration sign-off.
  - `@hermit-yoshino-xl`: profile UI flow and validation UX.
  - `@nanshengbeisheng`: closet upload/list UI and API integration.
  - `@jiruidai`: extraction pipeline integration and analysis status handling.
  - `@z8ri`: API tests, integration checks, and release readiness checklist.

- **Dependency order**
  - Complete auth/session first (R1), then profile/closet endpoints (R2/R3).
  - Enable extraction after closet upload path is stable (R4 depends on R3).
  - Need-input flow depends on auth middleware and shared request logging (R5 depends on R1).

## Task Breakdown

- Task: Implement Google OAuth callback flow and session/JWT middleware
  - Type: feature
  - Assignee(s): @FengqiHu
  - Requirement Number: #R1
  - Issue Number: TBD

- Task: Build login gate and protected-route handling in frontend
  - Type: task
  - Assignee(s): @FengqiHu
  - Requirement Number: #R1
  - Issue Number: TBD

- Task: Design and implement profile schema + profile read/update APIs
  - Type: feature
  - Assignee(s): @FengqiHu
  - Requirement Number: #R2
  - Issue Number: TBD

- Task: Build profile setup UI (height/weight + face/body image upload)
  - Type: feature
  - Assignee(s): @FengqiHu
  - Requirement Number: #R2
  - Issue Number: TBD

- Task: Implement user face/body image upload
  - Type: feature
  - Assignee(s): @nanshengbeisheng
  - Requirement Number: #R2
  - Issue Number: TBD

- Task: Implement closet item upload endpoint, storage write, and validation
  - Type: feature
  - Assignee(s): @nanshengbeisheng
  - Requirement Number: #R3
  - Issue Number: TBD

- Task: Build closet list page and upload interaction flow
  - Type: task
  - Assignee(s): @FengqiHu
  - Requirement Number: #R3
  - Issue Number: TBD

- Task: Build upload cloth image flow
  - Type: task
  - Assignee(s): @jiruidai
  - Requirement Number: #R3
  - Issue Number: TBD

- Task: Integrate Gemini-based extraction for uploaded closet items
  - Type: feature
  - Assignee(s): @jiruidai
  - Requirement Number: #R4
  - Issue Number: TBD

- Task: Add extraction status + error handling + retry-ready persistence fields
  - Type: task
  - Assignee(s): @jiruidai
  - Requirement Number: #R4
  - Issue Number: TBD

- Task: Implement needs submission API and request logging model
  - Type: feature
  - Assignee(s): @z8ri
  - Requirement Number: #R5
  - Issue Number: TBD

- Task: Build chat-style needs input UI and API integration
  - Type: task
  - Assignee(s): @FengqiHu
  - Requirement Number: #R5
  - Issue Number: TBD

- Task: Add API/integration test coverage for R1-R5 critical paths
  - Type: task
  - Assignee(s): @z8ri
  - Requirement Number: #R1, #R2, #R3, #R4, #R5
  - Issue Number: TBD
