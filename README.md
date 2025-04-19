# Buzz Board (New Readme)

Blank

# Docker Docs

## Local DB

```bash
docker compose --file ./docker-compose.db.yml down
docker compose --file ./docker-compose.db.yml up --detach
docker compose --file ./docker-compose.db.yml logs --follow  keydb
```

# Auth Docs

## Discord

Redirects:

- `http://localhost:3000/api/auth/callback/discord`

## Google

Redirects:

- `http://localhost:3000/api/auth/callback/google`
- `http://{CODESPACE-SUBDOMAIN}.app.github.dev/api/auth/callback/google`
- `https://{CODESPACE-SUBDOMAIN}.app.github.dev/api/auth/callback/google`
  - NOTE: you need http and https
  - Avoid wildcard since you can have a persistant code space.

# REPL Commands

```bash
bun repl
```

```Typescript
import { db } from "@/server/db"
```

# TODO

- [x] Make component for team swtiching that will invalidate `api.gameUser.getSelfInfo`
- [x] Update who buzzed in component to show user profile is user is linked
- [x] Make component for viewing self game user info that allows you to edit your name
  - if a user is associated to have an avatar
  - somehow make this a common component between user and game user
    - or make one for both
- [x] Move team changer to it's own component that can be used for other things
- Update buzzer button visuals
  - [x] make larger
  - encode off buzzer with color and icon
- Update scoreboard visuals
  - tile teams better
  - team score cards updates
    - encode off buzzer state with color and icon
    - score should be larrger
    - number of playsers should be displayed somewhere nicely
- Join page should have search params to auto load join code
- Create admin version of scoreboard
  - this version should have the join game code present
  - create QR code for join page and auto fill
- [x] Make a component for viewing team info and allowing the user to change the team name
  - [x] this should trigger a state change for the name to appear else where
- Refactor game selection to be a table and redirect you to say `/game/{gameId}/admin
- Allow the admin to toggle between allowing users between being open for users to join and locking user out.
- Admin page should have a tab for game user managed ment.
  - this management should should have a full user view and by team view
- [x] Game User info should show team mates
  - [x] need game user endpoint to get team mades and profile images
    - client should regularly invalidate this query, but not frequently
  - [x] create a table to show all team mates
- Split score control into a quick score control and an advanced score control
  - there are two quick score controls
    - team format
      - have a list of all the teams and an increment and decrement button
      - there should also be a box near the top to indicate how much.
        - this box should be a dropdown to be able to change the ammount.
    - single format
      - similar to team format, but instead of the teams, just all who is rejected and "all" selected
      - this feature will likely need a refactor to treat buzzers like scoreboards.
  - quick score control will have a list of all the teams
- [x] Game User should have two tabs
  - buzzer tab
  - game info tab
    - this tab should tell you infor about the game and who is on your team
- Game User Buzzer tab should have more feedback in error states
  - [x] when they buzz in
  - [x] when someone else buzzes in
  - [x] when someone on your team buzzes in
- [x] Refactor game event cache to use a redis-like service
  - this should be added to the docker compose
- Add more login providers:
  - Ideally just: Apple / Google / Discord
    - But will have to see how easy it is to swtich over to jwt (or use multiple token types)
  - For sure:
    - Github
    - Linkin
  - More than likley
    - Apple
    - Facebook
    - Instagram
  - Less than likely:
    - Slack
    - Battle.net

# Errors to Investigate

- ❌ tRPC failed on gameGeneral.whoBuzzedIn: Aborted
- ⨯ [Error [InvariantError]: Invariant: Cannot call waitUntil() on an AwaiterOnce that was already awaited. This is a bug in Next.js.]


# Future Feature

- Buzzed in queue. So everyone can buzz in, but the sequence who has buzzed is remembered.
  - this would need a "Next" button to move from the current "selected" to next in line and make previous rejected until whoever has something correct.

## Create T3 App

This is a [T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app`.

### What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs. If you still are in the wind, please join our [Discord](https://t3.gg/discord) and ask for help.

- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Prisma](https://prisma.io)
- [Drizzle](https://orm.drizzle.team)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

### Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

### How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.

# Buzz Board (Old Readme)

## Dependencies

You can run `install_dependencies.sh` to install the dependencies of the project.

### Server Dependencies

- redis

### Web Client Dependencies

- JQuery
- Materialize

These web dependencies are copied onto the server host. So the they are served up from the server rather than a CDN. This is to allow the project to run when there isn't internet. **Note** that downloading the web client dependencies still requires internet.

## Setup

- `config.json` (using `example_config.json`)
- Get your own audio files for `/web/buzzin.mp3` and `/web/incorectAnswer.mp3`
  - if you don't want audio then change the following lines in `/web/js/scoreboard.js`
    - from:
      `var buzzInSound = new Audio("/buzzIn.mp3");`
      `var inncorectAnswerSound = new Audio("/incorectAnswer.mp3");`
    - to:
      `var buzzInSound = null;`
      `var inncorectAnswerSound = null;`

## Server Start

1. start redis
   - Run the `redis_server.py` script in the project root directory.
2. start http
   - Run the `http_server.py` script in the project root directory.

## Interfaces

- player (`/`)
- scoreboard (`/scoreboard`)
- admin (`/admin`)

## How to Use

- Players access `/`
  - Then they select which team they are apart of.
  - They press the buzzer when they want to buzz in.
- The admin controls the state of the game.
  - Can toggles the listening state with the [**BUZZER LISTENING**] button.
    - When the question state is off (red), then no buzzer input is listened to.
      - The scoreboard top bar will be blue.
    - When the question state is on (green), then the first buzzer input is listened to.
      - The scoreboard top bar will be green.
  - Can modify the score on the board.
    - They select which team (or teams) they want to modify, and they can add/subtract/set the score.
      - Subtract is redundant, but there for convenience.
    * If the config has setup the `score_scale_factors` and are valid, there is a scale factor button that will multiple the value in the text box before applying the operation set.
  - If someone gets the question wrong they can press the [**KEEP LISTENING**] near the bottom of the page.
    - This will cause the server to continue listening, but not listen to the people who got the question wrong.
    - When done so, the team state is of who ever is `BUZZER_PRESSED` is changed to `BUZZER_PRESSED_FAILED`.
    - You will only ever see one team who has the state `BUZZER_PRESSED`.
  - If they want to reset the buzzer states, they can press the [**RESET BUZZER**] button on the bottom of the page.
    - Every team will be set to `BUZZER_NOT_PRESSED`

## Configurability

- Required fields in `config.json`:
  - `http.hostname`
  - `http.port`
  - `teams`
    - there are optional fields within teams.
    - You can have a object with the keys being the team names
      - Each team can have the property `key`, which will add security to the team buzzers.
        - If `key` is `null` or empty string, it is the same as not having there
        - With `key` being set, buzzing for a specific team will compare the password to verify.
          - If the password is wrong, the buzz request is ignored.
- Optional fields in `config.json`:
  - Admin Related:
    - `admin.key`
      - If `key` is `null`, then anyone who is aware of the admin page can use it.
      - If `key` is a string, then the admin page will have a password field at the bottom of the page. Any `POST` request made by the admin page will be checked against the password. If the password doesn't match, the `POST` request will be rejected.
        - Any request that modifies state is a `POST` request.
        - What this means is that anyone can load the admin page, but anything the admin page requests to do will need the password that is in the config.
    - `admin.score_presets`
      - These are quick access buttons for specific score values.
      - If this entry is not here, then this section on the admin page is **not** rendered.
    - `admin.slider`
      - This renders a slider for quick access to variable score values.
        - Useful on mobile browsers
      - If this entry is not here, then this section on the admin page is **not** rendered.
      - Required sub-fields:
        - `min`
        - `max`
      - Optional sub-fields:
        - `increment`
          - Default is set if given.
    - `admin.score_scale_factors`
      - This renders a dropdown for a multiplier that will be applied to the value for the admin operation.
      - If this entry is not here, then this section on the admin page is **not** rendered.
      - Required sub-fields:
        - `values`
      - Optional sub-fields:
        - `tol`
          - This defines the tolerance for testing floating point number comparison.
          - If not present, a default value is used.
          - Used to determine if a unitary (`x 1.0`) multiplier is present.
            - If you have floating point values close to `1.0`, then a smaller `tol` value should be used.
  - Scoreboard Related:
    - `scoreboard.poll`
      - This specifies the period between polls to the server for scoreboard updates.
      - If this entry is not here, then the scoreboard will poll at a default rate.
    - `scoreboard.refresh_threshold`
      - If this entry is not here, then the scoreboard will **not** refresh after a specific number of polls to the server.

## Security

There is very **basic** security. OAuth is a better way to do this if we were to do this for real. As a reminder, this is meant for personal use.

This project just uses pre-shared passwords set in the `config.json`. Read more in [Configurability](#Configurability) section. If you use the password based security in this project. You just have to control who know what password. I find this okay for the short term use of an instance of this project.

The admin key can be set without any of the team, and visa versa. But if one team has a key set, all the team must have keys set. With the team, it's all or nothing for setting keys.

This project also saves the pre-shared keys in local storage. Which is also not a very great practice.

## Versions

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
