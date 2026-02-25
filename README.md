# WearWise

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
| Deployment | Vercel (web + serverless), Render (workers) |
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

The client runs at `http://localhost:5173` and the server at `http://localhost:3000` by default.

## Running Tests

```bash
# Coming soon — Vitest
```

## Documentation

- Product Requirements: `docs/product-requirements.md`
- Project Roadmap: `docs/project-roadmap.md`
- Iteration Plans: `docs/iteration-x-plan.md`
- Team Agreement: `docs/team-agreement.md`
