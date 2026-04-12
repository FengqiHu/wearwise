# WearWise

**Live App:** https://wearwise-cs423.web.app/

WearWise is a personal cloud clothing library that lets you upload your wardrobe and get AI-powered outfit recommendations. Provide your clothing images and basic body info, and the agent recommends outfits based on weather, occasion, or personal preferences — then generates a virtual try-on image so you can see how each look would appear on you. You can also upload a product image from any online store to preview how it would fit with your existing wardrobe before buying.

## Prerequisites

- [Git](https://git-scm.com/downloads)
- [GitHub CLI (`gh`)](https://cli.github.com/) — used for issue, label, milestone, and PR management
- [Node.js](https://nodejs.org/)
- [MongoDB](https://www.mongodb.com/try/download/community)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | TypeScript, React |
| Backend | TypeScript, Express, Vercel |
| Database | MongoDB |
| Image Storage | Cloudflare R2 |
| Auth | Google OAuth 2.0 |
| Content Review | Google Cloud Vision – SafeSearch |
| Weather | OpenWeather API |
| AI (Reasoning) | Gemini |
| AI (Images) | Nano Banana |
| Deployment | Firebase (web + serverless), Render (workers) |
| Testing | Vitest |

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
| `OPENAI_API_KEY` | OpenAI API key for LLM reasoning |
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
| `GEMINI_API_KEY` | Gemini API key for outfit reasoning |
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

Tests are written with [Vitest](https://vitest.dev/) and live under `server/src/**/*.test.ts`.

```bash
cd server
npm test
```

This runs all server-side unit tests (services and repositories).

## Deployment

The application is deployed and accessible at https://wearwise-cs423.web.app/

- **Frontend**: Firebase Hosting
+ **Backend**: Render
