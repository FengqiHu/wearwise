# WearWise

**Live App:** https://wearwise-two.vercel.app/

WearWise is a personal cloud clothing library that lets you upload your wardrobe and get AI-powered outfit recommendations. Provide your clothing images and basic body info, and the agent recommends outfits based on weather, occasion, or personal preferences — then generates a virtual try-on image so you can see how each look would appear on you. You can also upload a product image from any online store to preview how it would fit with your existing wardrobe before buying.

## Prerequisites

- [Git](https://git-scm.com/downloads)
- [GitHub CLI (`gh`)](https://cli.github.com/) — used for issue, label, milestone, and PR management
- [Node.js](https://nodejs.org/)
- [MongoDB](https://www.mongodb.com/try/download/community)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | TypeScript, React (Vite, React Router, Tailwind CSS) |
| Backend | TypeScript, Express |
| Database | MongoDB |
| Image Storage | Cloudflare R2 |
| Auth | Google OAuth 2.0 |
| Content Review | OpenAI image moderation |
| Weather | OpenWeather API |
| Chat / Reasoning | OpenAI (gpt-5-mini) |
| Outfit Logic & Style Notes | OpenAI |
| Try-on Image Generation | OpenAI GPT Image |
| Frontend Hosting | Vercel |
| Backend Hosting | Railway |
| Testing | Vitest |

## Features

- **Google sign-in** — Sign in with your Google account; your WearWise data stays scoped to WearWise.
- **Personal closet** — Upload clothing photos, edit metadata (category, color, tags), replace or delete items.
- **Smart outfit recommendations** — Chat with the AI about what to wear; it considers your wardrobe, weather, occasion, and body profile.
- **Virtual try-on** — Generate a photorealistic image of any recommended outfit on your own body and headshot.
- **Online product try-on** — Upload a product photo from any store, see how it pairs with your existing closet, and try it on virtually — without adding it to your wardrobe.
- **Conversational accessory control** — Switch accessory inclusion in chat with natural language ("no accessories", "include accessories"); the dropdown stays in sync.
- **Preference learning** — Vote on the outfits you like; future recommendations adapt to your taste over time.
- **Image safety review** — Every uploaded image passes a content review before being stored.
- **Permanent account deletion** — Delete your WearWise account and all associated data from your profile page.

## Setup

```bash
# Clone the repository
git clone https://github.com/cs423sp26-homeworks/team-01.git
cd team-01

# Install all dependencies (root, client, and server)
npm run install-all
```

## Database

WearWise uses MongoDB as its primary database. Make sure MongoDB is running locally before starting the application. It will automatically create a `wearwise` database on the default port `27017`.

## Running the Application

```bash
# Start both client and server concurrently
npm start
```

Or run them separately:

```bash
# Server only
npm run server

# Client only
npm run client
```

The client runs at `http://localhost:5173` and the server at `http://localhost:3001` by default.

## Environment Variables

Copy the example files and fill in your values before starting the application.

### Server (`server/.env`)

```bash
cp server/.env.example server/.env
```

| Variable | Description |
|---|---|
| `PORT` | Port the server listens on (default `3001`) |
| `CLIENT_ORIGIN` | Frontend origin for CORS (e.g. `http://localhost:5173`) |
| `OPENAI_API_KEY` | OpenAI API key for chat, image review, recognition, recommendations, and generation |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | OAuth redirect URI (e.g. `http://localhost:5173/auth/callback`) |
| `AUTH_SESSION_SECRET` | Secret used to sign session tokens |
| `AUTH_SESSION_TTL_SECONDS` | Session lifetime in seconds (e.g. `604800` = 7 days) |
| `MONGODB_URI` | MongoDB connection string |
| `MONGODB_DB_NAME` | Database name (e.g. `wearwise`) |
| `MONGODB_USERS_COLLECTION` | Users collection name |
| `MONGODB_CONVERSATIONS_COLLECTION` | Conversations collection name |
| `S3_BUCKET` | Cloudflare R2 bucket name |
| `S3_ENDPOINT` | R2 endpoint URL |
| `S3_ACCESS_KEY_ID` | R2 access key ID |
| `S3_SECRET_ACCESS_KEY` | R2 secret access key |
| `S3_REGION` | R2 region (typically `auto`) |
| `S3_PUBLIC_BASE_URL` | Public base URL for serving stored images |
| `OPENAI_ANALYSIS_MODEL` | Shared default for recognition and recommendations (default `gpt-5-mini`) |
| `OPENAI_RECOMMENDATION_MODEL` | Optional shared default for style summaries and outfit recommendations |
| `OPENAI_IMAGE_MODEL` | Optional try-on model (default `gpt-image-2.5-sunburst`) |
| `OPENWEATHER_API_KEY` | OpenWeather API key for weather data |

### Client (`client/.env`)

```bash
cp client/.env.example client/.env
```

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | Backend URL (e.g. `http://localhost:3001`) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID (same as server) |
| `VITE_GOOGLE_REDIRECT_URI` | OAuth redirect URI (same as server) |

## Running Tests

Tests are written with [Vitest](https://vitest.dev/) and live under `server/src/**/*.test.ts` (backend) and `client/src/**/*.test.{ts,tsx}` (frontend).

Backend tests (services, repositories, and route handlers):

```bash
cd server
npm test
```

Frontend tests (page components and shared utilities):

```bash
cd client
npm test
```

## Deployment

The application is deployed and accessible at https://wearwise-two.vercel.app/

- **Frontend**: Vercel, with the project root set to `client`.
- **Backend**: Railway, with the service root set to `/server`.

Set the Vercel variables `VITE_API_BASE_URL=https://wearwise-production.up.railway.app`
and `VITE_GOOGLE_REDIRECT_URI=https://wearwise-two.vercel.app/auth/callback`.
On Railway, set `CLIENT_ORIGIN=https://wearwise-two.vercel.app` and the same
callback URL in `GOOGLE_REDIRECT_URI`. Add that exact callback URL to the Google
OAuth client's authorized redirect URIs.

Railway also needs a working `MONGODB_URI`. A healthy `/api/health` response only
confirms that Express is running; it does not check MongoDB. If sign-in logs show
`querySrv ENOTFOUND`, verify the Atlas cluster is available and copy its current
connection string into Railway. Google authentication can succeed while saving
the user fails because the database is unavailable.

Image uploads accept JPEG, PNG, WebP, HEIC, and HEIF. HEIC/HEIF photos are converted
to JPEG before image moderation, person/clothing recognition, and R2 storage.
Image processing uses `OPENAI_API_KEY`; Google OAuth still uses its own client
credentials. Google Vision billing and Gemini API credits are no longer required.
OpenAI image generation may require organization verification and available API credits.

## Model Selection

Set these variables in `server/.env` for local development, or in the Railway
service variables for production. Restart the server (redeploy on Railway) after
changing them; no source change or frontend rebuild is needed.

| Module | Environment variable | Default |
|---|---|---|
| Chat and tool calls | `OPENAI_CHAT_MODEL` | `gpt-5-mini` |
| Person detection | `OPENAI_HUMAN_PRESENCE_MODEL` | Analysis default |
| Clothing detection | `OPENAI_CLOTHING_PRESENCE_MODEL` | Analysis default |
| Clothing metadata extraction | `OPENAI_CLOTHING_EXTRACTION_MODEL` | Analysis default |
| Style summary | `OPENAI_STYLE_SUMMARY_MODEL` | Recommendation default |
| Wardrobe outfit completion | `OPENAI_OUTFIT_RECOMMENDATION_MODEL` | Recommendation default |
| Shop product pairing | `OPENAI_SHOP_RECOMMENDATION_MODEL` | Recommendation default |
| Image safety review | `OPENAI_MODERATION_MODEL` | `omni-moderation-latest` |
| Virtual try-on generation | `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-sunburst` |

A non-empty module variable wins over its shared default. The analysis default is
`OPENAI_ANALYSIS_MODEL`, falling back to `gpt-5-mini`. The recommendation default is
`OPENAI_RECOMMENDATION_MODEL`, falling back to the analysis default. Empty values
and surrounding whitespace are ignored. Chat, moderation, and image generation
are independent of these shared defaults.

Recognition models must support image inputs and structured outputs through
Responses. Recommendation models need Responses and structured outputs. Chat
models must support streaming and function calling through Chat Completions.
Moderation models must support images on the Moderations endpoint, and image
models must support reference-image editing on the Images endpoint. Keep model
IDs compatible with the module's endpoint; changing a model does not change its
API endpoint. Analysis requests retain `minimal` reasoning for the original GPT-5
family; other models use their provider default rather than inheriting an
unsupported effort setting. Service logs show the actual selected model.
