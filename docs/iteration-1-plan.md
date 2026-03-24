# Iteration 1 Plan

**Dates:** Week 5–6 (due 2026-03-08)

## Requirements & Acceptance Criteria

### R1. Google OAuth Login and Session Setup (#1)

**Description:** Users can sign in with Google and access authenticated app features with a valid session.

- **Acceptance Criteria:**
  - [x] Unauthenticated users can start Google OAuth and complete sign-in successfully.
  - [x] After successful login, users are redirected to the app and an authenticated session/JWT is established.
  - [x] Protected API routes reject unauthenticated requests with `401`.
  - [x] Sign-out removes session state and returns the user to a public page.

### R2. Personal Profile Creation (Images + Height/Weight) (#2)

**Description:** Users can create and save a personal profile with face image, full-body image, height, and weight.

- **Acceptance Criteria:**
  - [x] A logged-in user can submit height and weight with validation (required, numeric, positive values).
  - [x] A logged-in user can upload one face image and one full-body image for their profile.
  - [x] Profile data is persisted and can be retrieved on page refresh/re-login.
  - [x] Profile records are user-scoped; one user cannot read another user's profile.

### R3. Clothing Item Image Upload (#3)

**Description:** Users can upload clothing item images into their private cloud closet.

- **Acceptance Criteria:**
  - [x] A logged-in user can upload a clothing image from the UI.
  - [x] Uploaded item records are stored per user and visible in that user's closet list.
  - [x] Invalid file types or oversized files are rejected with a clear error.
  - [x] Users only see their own uploaded clothing items.

### R4. Clothing Attribute Extraction Pipeline (#4)

**Description:** After upload, the system extracts clothing metadata: name, category, tags, and description.

- **Acceptance Criteria:**
  - [x] New uploads trigger analysis automatically (sync or async worker).
  - [x] Extracted fields include `name`, `category`, `tags`, and `description`.
  - [x] Extraction output is persisted and queryable from closet item detail/list APIs.
  - [x] Failed analysis is marked with status and an error reason for retry/debugging.

### R5. Clothing Need Input (User-to-Agent Request Capture) (#5)

**Description:** Users can describe current clothing needs to the system through a chat-like input flow.

- **Acceptance Criteria:**
  - [x] Authenticated users can submit a natural-language clothing request.
  - [x] The request is saved with user ID and timestamp.
  - [x] The system returns a structured acknowledgement payload (occasion/weather/style intent fields).
  - [x] Submission errors are surfaced to users with actionable messages.

## Coordination & Design Decisions

- **Architecture scope for Iteration 1**
  - React (frontend) + TypeScript server APIs on Vercel.
  - MongoDB for user/profile/closet/request data.
  - Cloudflare R2 for profile and clothing image storage.
  - Gemini endpoint for clothing attribute extraction.

- **Data contracts**
  - `User`: `id`, `googleSubHash`, `emailHash`, `createdAt`.
  - `Profile`: `userId`, `height`, `weight`, `faceImageUrl`, `bodyImageUrl`, `updatedAt`.
  - `ClosetItem`: `id`, `userId`, `imageUrl`, `analysisStatus`, `name`, `category`, `tags[]`, `description`, `createdAt`.
  - `Conversation`: `id`, `userId`, `rawText`, `parsedIntent`, `createdAt`.

- **API contracts**
  - `POST /api/auth/google/callback`: finish login and return session token.
  - `GET /api/profile`, `PUT /api/profile`: read/update profile data.
  - `POST /api/profile/images`: upload profile images.
  - `POST /api/closet/items`, `GET /api/closet/items`: upload/list clothing items.
  - `POST /api/closet/items/:id/analyze`: trigger Gemini extraction.
  - `POST /api/chat`: submit user clothing-need requests.

- **Ownership**
  - `@FengqiHu`: Auth/session architecture (#6, #7), profile APIs (#8, #9), chat feature (#16, #17), bug fix for profile creation redirect (#19).
  - `@Nanshengbeisheng`: Face/body image upload to Cloudflare R2 (#10), closet upload pipeline (#11, #13).
  - `@z8ri`: Closet item upload endpoint (#11), closet list page and upload UI (#12, #13).
  - `@jiruidai`: Gemini image understanding (#23), structured extraction output (#24), extraction status/error persistence (#15), Gemini integration for closet items (#14). R4 and R5 feature issues (#4, #5).
  - `@hermit-yoshino-xl`: Initial picture generation pipeline with Gemini and R2 upload (#21).

- **Dependency order**
  - Auth/session first (R1 → #6, #7), then profile/closet endpoints (R2 → #8–#10, R3 → #11–#13).
  - Extraction after closet upload path is stable (R4 → #14, #15, #23, #24 depend on R3).
  - Chat flow depends on auth middleware (R5 → #16, #17 depend on R1).

## What Was Not Completed

- **#18** — API/integration test coverage for R1–R5 critical paths: not completed, carried to Iteration 2 scope.
