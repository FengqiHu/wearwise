# Technology Decisions

This document explains _why_ we chose every piece of this stack. Not just what we use, but the reasoning behind it. If you understand the philosophy, you can make good decisions when extending or adapting this project.

## The Core Principle

**Purpose-built tools that solve real problems at the right layer.**

WearWise is a personal cloud clothing library with AI-powered outfit recommendations and virtual try-on. Every technology choice is made with three constraints in mind:

- **User data is sensitive** — body photos and personal images require secure storage, consent gating, and clear privacy boundaries
- **AI workloads are heavy** — image generation and LLM inference can take tens of seconds; the architecture must handle async work without blocking users
- **The team is small** — every tool must be learnable and operable without a dedicated DevOps function

## Development Tooling

### Claude Code as the Development Agent

This project is built _with_ AI, not just _for_ AI. Claude Code is an agentic coding tool that reads the codebase and makes changes across files. The `.claude/rules/` directory encodes constraints (branch naming, commit format, PR conventions) that Claude Code follows automatically. The `.claude/skills/` directory encodes deeper patterns that Claude Code consults when generating code.

For a collaborative course project, this solves the consistency problem: every team member's AI assistant follows the same conventions and produces code that fits the existing architecture.

### GitHub for Collaboration

GitHub Issues (with `feature`, `bug`, `task` labels and iteration milestones), pull requests, and Actions handle the full project lifecycle without introducing a separate project management tool. The `gh` CLI lets Claude Code create issues, open PRs, and check CI status from the terminal. GitHub Actions runs CI on every PR and deploys on merge to `master`.

## The App Stack

### TypeScript over JavaScript

Types are documentation the compiler enforces. For an AI-assisted codebase with multiple contributors, types give Claude context about expected shapes and let teammates understand unfamiliar code quickly. The cost is negligible.

### React (Frontend)

React has the largest corpus of AI training data and the most stable core mental model (components, props, hooks) since 2019. The job market is React-dominated. For a teaching context, those properties matter more than framework novelty.

### Express.js + Node.js (Backend API)

The backend is a TypeScript Express server. Express gives us a straightforward, well-understood HTTP layer without the constraints of a serverless platform — no timeout limits, no cold starts, and full control over middleware and connection pooling. Routes handle authentication callbacks, database queries, AI API proxying, and R2 presigned URL generation. The server runs with `tsx watch` in development and compiled TypeScript in production.

### Render (Backend — Long-Running Workers)

Image generation with Nano Banana can take 60–90 seconds. A long-running Render service polls for pending generation jobs, calls the Nano Banana API, and writes results back to MongoDB and R2. This clean separation keeps the main Express API fast and delegates slow work to a process designed for it.

### MongoDB

WearWise's data model is user-centric and document-shaped: each user has a profile and a collection of clothing items, each with extracted attributes (name, category, tags, description). A document database maps naturally to this structure without requiring rigid schema migrations every time the clothing attribute model evolves. MongoDB Atlas provides a free tier sufficient for course-scale usage with built-in indexing, and the Node.js driver is mature and well-documented.

### Cloudflare R2 (Image Storage)

User photos (face, full-body) and clothing images are the core asset type in WearWise. Storing binary assets in MongoDB is an antipattern. R2 provides S3-compatible object storage with:

- **No egress fees** — unlike AWS S3, R2 does not charge for data transfer out. For an image-heavy application, this is significant.
- **Presigned URLs** — the backend generates short-lived signed URLs for upload and retrieval, so the frontend never handles credentials and R2 is never directly exposed.
- **Cloudflare's global network** — images are served from edge locations close to users.

### Google OAuth 2.0 (Authentication)

Rolling your own auth is a security liability. Google OAuth delegates credential management to Google, gives users a familiar sign-in flow, and provides a verified email address as a stable user identifier. JWT tokens issued after OAuth sign-in are used for session validation on subsequent API requests.

**Known issue:** Redirect URIs must be configured precisely in the Google Cloud Console. A mismatch between the registered redirect URI and the actual callback URL is the most common auth failure during local development and new environment setup.

### Google Cloud Vision – SafeSearch (Consent Review)

WearWise users upload photos of themselves and their clothing. Before storing any image, the system runs it through Cloud Vision's SafeSearch API to detect explicit content (adult, violent, medical) and reject uploads that exceed thresholds. This is a safety boundary, not a feature. Cloud Vision's paid tier does not use submitted content for model training.

### OpenWeather API (Weather Query)

Outfit recommendations are context-aware. The agent invokes OpenWeather as a tool to get current conditions (temperature, precipitation, wind) for the user's location. OpenWeather's free tier provides current weather data sufficient for recommendation context. The API is called at recommendation time, not stored — weather is ephemeral.

### Gemini (AI Reasoning — Outfit Recommendations)

Gemini handles the reasoning-heavy work: analyzing a user's cloud closet, interpreting their natural language request, incorporating weather context, and producing three distinct outfit recommendations. Key reasons for Gemini:

- **Multimodal** — Gemini can process both text and images, which matters when the agent needs to reason about clothing visuals alongside descriptions
- **Tool use** — Gemini supports function calling, allowing the agent to invoke the weather query tool and the clothing search tool within a single reasoning pass
- **Paid tier privacy** — Google's Gemini API paid tier does not use submitted content (including images) for model training

### Nano Banana (Image Generation — Virtual Try-On)

Nano Banana provides the virtual try-on API: given a user's full-body photo and clothing item images, it composites a realistic image of the user wearing the outfit. This is a specialized model for human try-on, not a general image generator. It is invoked asynchronously via the Render worker because generation takes 60–90 seconds.

### Vitest (Testing)

Vitest is the natural test runner for a Vite-based project — it reuses the same config, aliases, and transforms with zero additional bundler configuration. Its API is Jest-compatible, meaning existing knowledge transfers and AI tooling generates correct test code. Used for unit and integration tests of API handlers, utility functions, and store logic.

## Architecture Pattern

The key architectural boundary is between the **synchronous API** (Express server — fast, stateless requests) and the **asynchronous worker** (Render — slow, stateful jobs):

1. User requests outfit recommendations → Express API validates the request, writes a job to MongoDB, returns immediately
2. Render worker polls MongoDB for pending jobs → calls Gemini for outfit selection → calls Nano Banana for each try-on image → updates job status and writes results to MongoDB + R2
3. Frontend polls job status → displays results when complete

This pattern keeps the user-facing API responsive regardless of how long image generation takes.

## The Guiding Heuristic

When evaluating a tool, ask:

- **Does it solve a real problem we actually have?** Not a hypothetical future one.
- **Is it safe for user data?** Especially for image storage, auth, and AI processing.
- **Can a small team operate it?** Minimal infrastructure management.
- **Does it scale to zero or near-zero cost at low usage?** Course projects are not production traffic.
