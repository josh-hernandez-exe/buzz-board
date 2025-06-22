# Buzz Board

## Summary

Buzz Board is a game management platform built on the T3 Stack, designed to facilitate interactive team-based games. The platform allows authenticated users to create and manage games, while game participants can join games and use buzzers to interact. The project leverages modern web technologies to provide a seamless and scalable experience.

### About the T3 Stack
The [T3 Stack](https://create.t3.gg/) is a modular and type-safe full-stack development framework. It emphasizes simplicity, scalability, and developer experience. Buzz Board utilizes the following technologies from the T3 Stack:

### Tech Stack
- **[Next.js](https://nextjs.org)**: A React framework for building server-rendered applications.
- **[NextAuth.js](https://next-auth.js.org)**: For user authentication and session management.
- **[Prisma](https://prisma.io)**: A modern ORM for database management.
- **[Tailwind CSS](https://tailwindcss.com)**: A utility-first CSS framework for styling.
- **[tRPC](https://trpc.io)**: For type-safe API development.
- **shadcn**: For reusable UI components.
- **neverthrow**: For handling function results with `ok` and `err` return styles. (When appropriate)

### Backend Infrastructure
- **PostgreSQL**: Used as the primary database.
- **KeyDB**: A high-performance in-memory database for caching and real-time updates.

## Usage

### Authenticated Users
- Create and manage games as an admin.
- Use the admin interface to control game settings, manage teams, and oversee gameplay.

### Game Participants
- Join a game using a unique game code.
- Use the buzzer to interact during gameplay.


## Development Setup

### Prerequisites
1. Install Docker and Docker Compose.
2. Install `bun` for package management.

### Setup Auth

#### Discord

Redirects:

- `http://localhost:3000/api/auth/callback/discord`
- `http://{CODESPACE-SUBDOMAIN}.app.github.dev/api/auth/callback/discord`
- `https://{CODESPACE-SUBDOMAIN}.app.github.dev/api/auth/callback/discord`
- https://musical-space-engine-49grxqww6pfqvjq-3000.app.github.dev/api/auth/callback/discord

#### Google

Redirects:

- `http://localhost:3000/api/auth/callback/google`
- `http://{CODESPACE-SUBDOMAIN}.app.github.dev/api/auth/callback/google`
- `https://{CODESPACE-SUBDOMAIN}.app.github.dev/api/auth/callback/google`
  - NOTE: you need http and https
  - Avoid wildcard since you can have a persistant code space.


### Getting Started
1. Clone the repository.
2. Install dependencies with `bun install`
3. Create an `.env` file based on `.env.example` and configure your environment variables.
   - Set up authentication credentials for providers like Google and Discord. Refer to the [NextAuth.js documentation](https://next-auth.js.org/getting-started/introduction) for details.
   - Add the required URLs to the whitelist in your authentication provider settings. Refer to the [Auth Docs](https://next-auth.js.org/getting-started/introduction) for more information.
4. Start the development environment:
   ```bash
   docker compose --file ./docker-compose.db.yml up --detach
   bun db:push
   bun dev
   ```

### Common Commands
- Start the database and backend services:
  ```bash
  docker compose --file ./docker-compose.db.yml up --detach
  ```
- Apply database migrations:
  ```bash
  bun db:push
  ```
- Start the development server:
  ```bash
  bun dev
  ```
- Open a REPL for debugging:
  ```bash
  bun repl
  ```
  Example REPL preamble:
  ```typescript
  import { db } from "@/server/db";
  ```
- View database with prisma studio. Note by default the this is on port 5555.
  ```bash
  bun db:studio
  ```


## Deployment

Buzz Board is designed to be deployed on Vercel for a seamless and scalable hosting experience. Follow the [Vercel Deployment Guide](https://create.t3.gg/en/deployment/vercel) for detailed instructions on deploying T3 Stack applications.

```bash
git checkout production
git merge --ff-only development
```

### Steps to Deploy on Vercel
1. **Connect Your Repository**:
   - Log in to your Vercel account and connect your GitHub repository.
2. **Set Environment Variables**:
   - Add all required environment variables from your `.env` file to the Vercel dashboard under the "Environment Variables" section.
3. **Build and Deploy**:
   - Vercel will automatically detect the Next.js framework and configure the build settings.
   - Click "Deploy" to start the deployment process.
4. **Post-Deployment Configuration**:
   - Ensure that your authentication provider redirect URLs are updated to include the Vercel domain.
   - Refer to the [NextAuth.js documentation](https://next-auth.js.org/getting-started/introduction) for configuring authentication in production.

#### Notes
- Vercel provides automatic HTTPS, serverless functions, and CDN for optimal performance.
- For advanced configurations, refer to the [Vercel Documentation](https://vercel.com/docs).


### Database Deployment on Vercel

Buzz Board leverages Vercel's managed services for PostgreSQL and Redis to simplify database deployment and management. These services provide high availability, scalability, and seamless integration with your Vercel-hosted application.

#### Steps to Deploy Database Services on Vercel
1. **Set Up PostgreSQL**:
   - Use the [Vercel PostgreSQL Integration](https://vercel.com/docs/postgres) to provision a managed PostgreSQL database.
   - After provisioning, update your `.env` file with the connection string provided by Vercel:
     ```env
     DATABASE_URL=your-vercel-postgres-connection-string
     ```

2. **Set Up Redis**:
   - Use the [Vercel Redis Integration](https://vercel.com/docs/storage) to provision a managed Redis instance.
   - Update your `.env` file with the Redis connection string:
     ```env
     KV_URL=your-vercel-redis-connection-string
     ```

3. **Apply Database Migrations**:
   - Run Prisma migrations to set up the database schema:
     ```bash
     bun --env-file=.env.production prisma migrate reset
     bun --env-file=.env.production db:push
     ```

4. **Verify Connections**:
   - Ensure that your application can connect to the managed PostgreSQL and Redis instances by testing locally or deploying to Vercel.

#### Notes
- Vercel's managed PostgreSQL and Redis services are optimized for production use and include features like automatic backups and monitoring.
- For advanced configurations, refer to the [Vercel PostgreSQL Documentation](https://vercel.com/docs/postgres) and [Vercel Storage (redis-like) Documentation](https://vercel.com/docs/storage).

## TODO

- Admin needs to be able to move players between teams.
- Admin page should have a tab for game user management.
  - This management should have a full user view and a by-team view.
- Admin must be able to turn off team switching
- Update scoreboard visuals:
  - Tile teams better.
  - Team score cards updates:
    - Score should be larger.
    - Number of players should be displayed somewhere nicely.
- Split score control into a quick score control and an advanced score control:
  - Quick score control:
    - Team format:
      - Have a list of all the teams and an increment and decrement button.
      - There should also be a box near the top to indicate how much.
        - This box should be a dropdown to be able to change the amount.
    - Single format:
      - Similar to team format, but instead of the teams, just all who is rejected and "all" selected.
      - This feature will likely need a refactor to treat buzzers like scoreboards.
  - Quick score control will have a list of all the teams.
- Add more login providers:
  - Ideally just: Apple / Google / Discord.
    - But will have to see how easy it is to switch over to JWT (or use multiple token types).
  - For sure:
    - GitHub.
    - LinkedIn.
  - More than likely:
    - Apple.
    - Facebook.
    - Instagram.
  - Less than likely:
    - Slack.
    - Battle.net.
- Migrate from "(Classic) React Query Integration" to pure TanStack React Query
  - https://trpc.io/docs/client/tanstack-react-query/setup
- Consider swtiching from prisma cloud to something else
  - prisma prices per request ask 100k
  - supabase free teir caps at 5 GB of bandwidth
  - neon prices in compute hours after 190
    - $0.16 per hour over
    - [compute hours] = [compute size] x [hours your compute runs]
    - https://neon.tech/pricing#compute-hour
    - with autoscaling the computer size can decrese
      - https://neon.tech/docs/introduction/autoscaling
      - Autoscaling currently supports a range of 1/4 (.25) to 16 vCPUs
      - free tier
        - 0.25 CPU would last the whole month
        - max size is 2 CPU
        - they offer scaling to zero




### Errors to Investigate

- ❌ tRPC failed on gameGeneral.whoBuzzedIn: Aborted
- ⨯ [Error [InvariantError]: Invariant: Cannot call waitUntil() on an AwaiterOnce that was already awaited. This is a bug in Next.js.]



## Future Features

- Buzzed in queue. So everyone can buzz in, but the sequence who has buzzed is remembered.
  - this would need a "Next" button to move from the current "selected" to next in line and make previous rejected until whoever has something correct.
- Have an option to not use the score mechanism.
* In the future, the `null` team will auto select the teams who buzzed in and apply score changes to them.
	* Teams with the state `BUZZER_PRESSED_FAILED` will have their score removed from them.
	* The team with the state `BUZZER_PRESSED` will have their score increased.

## External Sources

### Sound Effects

- buzz-in
  - https://pixabay.com/sound-effects/ding-101492/
- wrong-answer
  - https://pixabay.com/sound-effects/buzzer-or-wrong-answer-20582/


## Change Log

### Version 1.0.0

- Initial Release

### Version 1.0.1

- Made the http server be threaded, note that the class `BaseHTTPServer.HTTPServer` is single threaded

### Version 1.0.2

- The scoreboard meta data is no logger written to file and read from file, but now just kept in memory. This has increased the response time of the scoreboard page.

### Version 2.0.0

- Several Admin Features have been added.
  - As a result, the configuation data sent from server to client is very different
  - Multiple teams can be sent in an operation
    - A set operation for multiple teams is broken down into several additions and subtractions
  - The set operation now changes the scaleFactor to `1.0`

### Version 2.1.0

- The scoreboard page is configurable inside of the `config.json`. The `example_config.json` should be updated showing how.
  - The poll period (how often the scoreboard makes a `GET` request to the server for new info) is configurable.
  - The refresh threshold can be configurable. The scoreboard tracks the number of times it has made requests to the server, when the count exceeds the threshold, the page is refreshed. This is normally an issue when the page is viewed on a mobile browser.
- Added admin feature to select team who has buzzed in (team buzzer state `1`), and select all the teams who have buzzed in but got the wrong answer (team buzzer state `2`).

### Version 3.0

- Python 3 compatiblity
  - Tested with Python 3.6
- Basic security features
- Project setup now downloads the web client dependencies into the host server.
  - The server now serves up these files instead rather than using the CDN.
    - This allows the project to run without internet.
      - Although inital project setup still requires internet.

### Version 3.1

- Dockerized the build.


### Version 4.0.0 (Rewrite)
- Migrated the project to the T3 Stack.
- Introduced modern technologies: Next.js, Prisma, tRPC, Tailwind CSS, and shadcn.
- Added support for multiple authentication providers via NextAuth.js.
- Refactored the backend to use PostgreSQL and KeyDB.
- Improved UI/UX with Tailwind CSS and reusable components.
- Enhanced error handling using `neverthrow`.
- Updated the README with detailed setup and usage instructions.
