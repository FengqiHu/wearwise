# Project Configuration

## Project Description

The main idea of our project is to create a personal cloud clothing library. Users provide images of their clothing items along with basic body information. After that, our agent can recommend several outfits based on the user’s current needs, such as the weather, occasion, or personal preferences, and generate images showing how each outfit would look. 

Additionally, when users want to buy new clothes, our agent can help them make decisions by showing how the new items would look on their body and suggesting possible combinations with their existing wardrobe.

## Tech Stack


* **Frontend**: TypeScript, React

* **Backend**: TypeScript, Vercel

* **Database**: MongoDB

* **Image Storage:Cloudflare R2

* **Auth:** Google OAuth 2.0

* **Consent Review:** Google Cloud Vision – SafeSearch

* **Weather API**:OpenWeather(weather query)

* **AI Services:Gemini (reasoning for recommendation), Nano Banana (image generation)

* **Deployment:** Vercel for web app and serverless APIs, Render for long-running workers

* **Testing:** Vitest


## Commands

<!-- TODO: Fill in after choosing your tech stack -->

- Install dependencies: `npm install`
- Run development server: `npm run dev`
- Run tests: `<command>`
- Run linter: `<command>`
- Build for production: `<command>`

## Code Style

<!-- TODO: Document your team's style decisions -->

- Formatting: (e.g., Prettier, Black, etc.)
- Linting: (e.g., ESLint, Ruff, etc.)
- Naming conventions: (e.g., camelCase for JS, snake_case for Python)

## Architecture

<!-- TODO: Describe your project structure -->

## Branch & Commit Conventions

- Branch pattern: `<author>/<type>/issue-<number>-<short-description>`
  - `type` must match the issue label: `feature`, `bug`, or `task`
- Never push directly to master
- Reference issues in commits: `Add file validation (#12)`
- Keep PRs under ~400 changed lines
- Use merge commits (no squash or rebase)

## Common Mistakes

<!-- TODO: Add patterns your team discovers during development -->

- [ ] Google OAuth configured wrong redirect link making some errors.
- [ ] Fail to install MongoDB 
- [ ] Creating issues for future iterations instead of the current one