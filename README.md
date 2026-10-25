# GroupBot — WhatsApp Quiz Bot

A WhatsApp bot that **generates a randomized quiz every day**, **drops the questions into a group at random times** across a configurable window, **collects the answers** people reply with, and **stores the data needed to build a leaderboard**.

Quizzes are AI-generated (Google Gemini). Questions are one-word-answer questions by design, so grading is a simple string match.

---

## Table of Contents

- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Scheduling: does it use CRON?](#scheduling-does-it-use-cron)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration (`env.json`)](#configuration-envjson)
- [Running the bot](#running-the-bot)
- [First-time WhatsApp login (QR)](#first-time-whatsapp-login-qr)
- [Data files](#data-files)
- [Leaderboard](#leaderboard)
- [Running 24/7](#running-247)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)

---

## How it works

The pipeline has two independent schedulers that talk to each other through JSON files on disk.

```
                        ┌──────────────────────────────┐
   once per day at      │  quizmaker.js                │
   env.fetchTime  ────► │  Google Gemini generates N   │ ───► writes quiz.json
                        │  questions (1-word answers)  │
                        └──────────────────────────────┘
                                        │
                                        ▼
                        ┌──────────────────────────────┐
   N random times       │  creeper.js                  │
   inside the           │  1 quiz question per random  │ ───► sends question
   delivery window ───► │  time, inside                │      to WhatsApp group
                        │  deliveryStart..deliveryEnd  │
                        └──────────────────────────────┘
                                        │
                          people reply in the group
                                        │
                                        ▼
                        ┌──────────────────────────────┐
                        │  creeper.js (message listener)│ ───► writes response.json
                        │  matches reply to answer,    │      (responders, order,
                        │  dedupes, caps maxResponse   │       timestamps)
                        └──────────────────────────────┘
```

1. **Daily quiz generation** — [`quizmaker.js`](file:///Users/rohanbhoi/Desktop/GroupBot/quizmaker.js) calls Google Gemini (`@google/genai`) once a day at `env.fetchTime`, requesting exactly `env.questionCount` questions that each have a **single-word** answer. Result is written to `quiz.json`. It skips generation if a quiz was already generated today (`generatedAt` date check).
2. **Random delivery** — [`creeper.js`](file:///Users/rohanbhoi/Desktop/GroupBot/creeper.js) reads `quiz.json`, generates **one random time per question** inside the `deliveryStart`–`deliveryEnd` window, and schedules a send for each. Times that already passed are skipped.
3. **Answer collection** — the same file listens to group messages. A reply is recorded only if:
   - it is a **reply to a message** (`hasQuotedMsg`),
   - its trimmed, lowercased body **equals a quiz answer**,
   - the question has **not yet reached `maxResponse`** responders,
   - the **same user has not already answered** that question.
   Each valid answer is appended to [`response.json`](file:///Users/rohanbhoi/Desktop/GroupBot/response.json) in the order it arrived, with the user id, contact info, and an ISO timestamp.

There is also a small demo listener in [`main.js`](file:///Users/rohanbhoi/Desktop/GroupBot/main.js) that replies `Hello 👋` to the word `hello`, and an orchestrator entry point in [`dean.js`](file:///Users/rohanbhoi/Desktop/GroupBot/dean.js).

---

## Project structure

| File | Role |
| --- | --- |
| [`dean.js`](file:///Users/rohanbhoi/Desktop/GroupBot/dean.js) | Entry point. Boots the daily quiz generator. |
| [`quizmaker.js`](file:///Users/rohanbhoi/Desktop/GroupBot/quizmaker.js) | Generates the daily quiz with Gemini and writes `quiz.json`. |
| [`creeper.js`](file:///Users/rohanbhoi/Desktop/GroupBot/creeper.js) | Random-time delivery scheduler + answer collector → `response.json`. |
| [`main.js`](file:///Users/rohanbhoi/Desktop/GroupBot/main.js) | Minimal demo listener (auto-replies to `hello`). |
| [`env.json`](file:///Users/rohanbhoi/Desktop/GroupBot/env.json) | All configuration (API key, model, timings, window, group id, paths). **Gitignored.** |
| [`quiz.json`](file:///Users/rohanbhoi/Desktop/GroupBot/quiz.json) | Today's generated quiz (produced at runtime, gitignored). |
| [`response.json`](file:///Users/rohanbhoi/Desktop/GroupBot/response.json) | Collected answers/responders (produced at runtime, gitignored). |
| `session/` | WhatsApp/Puppeteer login session (gitignored). Delete to force a new QR login. |
| `node_modules.tar.gz` | Pre-packed dependencies (offline install). |

---

## Scheduling: does it use CRON?

**No. This project does not use CRON jobs** — not `node-cron`, not a system `crontab`, not any `.cron`/scheduler service file. A search for cron usage in the source turns up nothing.

Instead, all scheduling is done **inside the running Node process** using the built-in `setTimeout`:

| What is scheduled | Where | Mechanism |
| --- | --- | --- |
| Daily quiz generation at `fetchTime` | [`quizmaker.js`](file:///Users/rohanbhoi/Desktop/GroupBot/quizmaker.js#L320-L350) | `setTimeout`, re-schedules itself for the next day after each run |
| Each question's random send time | [`creeper.js`](file:///Users/rohanbhoi/Desktop/GroupBot/creeper.js#L395-L449) | one `setTimeout` per question |

### What this means for you

- **The process must stay running 24/7.** If you close the terminal / kill the process, pending sends are lost and the daily generation won't fire. See [Running 24/7](#running-247).
- **Timers do not survive a restart** (they live in memory). Mitigations already built in:
  - `creeper.js` re-schedules the whole day's delivery window on startup (its `initializeQuizScheduler()` runs at module load).
  - `quizmaker.js` has catch-up logic: if the bot starts *after* `fetchTime` and today's quiz is missing, it generates it immediately.
- If you prefer real CRON, you can run the bot under an OS scheduler (see [Running 24/7](#running-247)) — but the current code is designed to run as one long-lived process.

---

## Requirements

- **Node.js** 18+ (uses `fs/promises`, `@google/genai`)
- **npm**
- A **Chromium-based browser** — used by Puppeteer for `whatsapp-web.js`. Optional: if you don't configure one, Puppeteer's own bundled Chromium is used.
- A **WhatsApp account** that can be linked (you'll scan a QR code)
- A **Google Gemini API key** (Google AI Studio)

---

## Installation

1. **Get the dependencies.**

   They are already vendored in `node_modules.tar.gz`. Either extract it:

   ```bash
   tar -xzf node_modules.tar.gz
   ```

   …or install from npm:

   ```bash
   npm install
   ```

   `whatsapp-web.js`, `@google/genai`, and `qrcode-terminal` are all declared in `package.json`, so a single `npm install` is enough.

2. **Create `env.json`** in the project root (it is gitignored, so it won't exist on a fresh clone). This file holds **all machine-specific settings and secrets** — API key, group id, and optional browser/session paths. See [Configuration](#configuration-envjson).

3. **Set `groupId`** in `env.json` to your target group's id (format `1234567890-1234567890@g.us`). To discover it, run the demo (`npm run demo`) and watch the `FROM:` line printed for any group message.

Nothing needs to be edited in the source code — no paths, keys, or ids are hardcoded anywhere.

---

## Configuration (`env.json`)

All behavior is driven by [`env.json`](file:///Users/rohanbhoi/Desktop/GroupBot/env.json) in the project root. It is **gitignored**, which is why the API key and machine-specific paths live here and never in the source:

```json
{
  "apiKey": "YOUR_GEMINI_API_KEY",
  "model": "gemini-3.5-flash-lite",
  "questionCount": 10,
  "prompt": "Create an anime-themed one-word-answer quiz.",
  "answerTime": 30,
  "fetchTime": "18:42",
  "maxResponse": 10,
  "deliveryStart": "00:30",
  "deliveryEnd": "00:33",

  "groupId": "1234567890-1234567890@g.us",
  "browserExecutablePath": "/path/to/your/browser"
}
```

| Field | Type | Used by | Meaning |
| --- | --- | --- | --- |
| `apiKey` | string | `quizmaker.js` | Google Gemini API key. **Keep secret.** |
| `model` | string | `quizmaker.js` | Gemini model id used for generation. |
| `questionCount` | int > 0 | `quizmaker.js` | Number of questions generated per day. |
| `prompt` | string | `quizmaker.js` | Topic/theme instructions for the quiz. Must be non-empty. |
| `answerTime` | int > 0 | `quizmaker.js` | Answer time (seconds); persisted into `quiz.json`. |
| `fetchTime` | `HH:mm` | `quizmaker.js` | Time of day the daily quiz is generated. |
| `maxResponse` | int > 0 | `creeper.js` | Max responders accepted per question. |
| `deliveryStart` | `HH:mm` | `creeper.js` | Start of the random delivery window. |
| `deliveryEnd` | `HH:mm` | `creeper.js` | End of the window; **must be later than `deliveryStart`**. |
| `groupId` | string | `creeper.js`, `main.js` | Target WhatsApp group id (e.g. `1234567890-1234567890@g.us`). |
| `browserExecutablePath` | string | `creeper.js`, `main.js` | *Optional.* Absolute path to a Chromium-based browser. Omit to use Puppeteer's bundled Chromium. |
| `sessionPath` | string | `creeper.js`, `main.js` | *Optional.* Where the WhatsApp login session is stored. Defaults to `./session` next to the code. |

Validation is strict: `quizmaker.js` and `creeper.js` throw clear errors on bad `HH:mm` formats, non-integer counts, empty prompts, or `deliveryEnd <= deliveryStart`.

> **Tip:** for a full-day spread, set e.g. `deliveryStart: "09:00"`, `deliveryEnd: "21:00"`. The window is interpreted within a **single day** (`deliveryEnd` must be after `deliveryStart`; it does not wrap past midnight).

---

## Running the bot

Start the quiz pipeline (daily generation + delivery + answer collection):

```bash
npm start      # or: node dean.js
```

(`npm run demo` runs `main.js` instead — the small listener that replies `Hello 👋` to the word `hello`, useful for finding your `groupId`.)

On start you should see:

```
Initializing...
Client is ready!
Scheduling <N> quiz questions.
Delivery window: HH:mm - HH:mm
Question scheduled for HH:mm
Next quiz generation scheduled for HH:mm.
```

---

## First-time WhatsApp login (QR)

On the very first run (or after deleting `session/`), the terminal prints a **QR code** (via `qrcode-terminal`).

1. Run `node dean.js`.
2. Open WhatsApp on your phone → **Settings → Linked Devices → Link a Device**.
3. Scan the terminal QR code.
4. Once you see `Client is ready!`, the session is stored under `session/` and future runs won't ask for a QR again.

---

## Data files

### `quiz.json` (output of `quizmaker.js`)

```json
{
  "generatedAt": "2026-08-30T13:23:04.848Z",
  "answerTime": 30,
  "questions": [
    { "question": "What sport is the focus of the anime Haikyuu?", "answer": "Volleyball" }
  ]
}
```

### `response.json` (output of `creeper.js`)

Keyed by question text; responders are stored in the **order they answered correctly** — this is the raw material for the leaderboard.

```json
{
  "What is the highest rank a demon slayer can achieve in Demon Slayer?": {
    "question": "What is the highest rank a demon slayer can achieve in Demon Slayer?",
    "answer": "Hashira",
    "responders": [
      {
        "userId": "255796021620832@lid",
        "contact": { "id": "917224841569@c.us", "pushname": "Rohan" },
        "answeredAt": "2026-08-30T19:00:46.142Z"
      }
    ]
  }
}
```

Both files are gitignored — they are generated at runtime and can contain participant names and phone-number ids.

---

## Leaderboard

The bot **collects** everything needed for a leaderboard, but **the repository does not ship a leaderboard generator** — there is no scoring module or leaderboard command. The data lives in `response.json`: every entry has a `userId`, `contact.pushname`, and `answeredAt`.

To produce a leaderboard, aggregate `response.json` by user — for example, count correct answers (and optionally rank by speed using `answeredAt`):

```js
const responses = require('./response.json');

const scores = {};
for (const { responders } of Object.values(responses)) {
  responders.forEach((r, i) => {
    const name = r.contact?.pushname || r.userId;
    scores[name] = scores[name] || { name, correct: 0 };
    scores[name].correct += 1;
  });
}

console.table(
  Object.values(scores).sort((a, b) => b.correct - a.correct)
);
```

Run it with `node leaderboard.js` after saving the snippet (not included here to keep the repo minimal).

---

## Running 24/7

Because there is **no CRON** and timers are in-memory, the bot must run as a continuous process. Common options:

- **pm2** (simplest):
  ```bash
  npm install -g pm2
  pm2 start dean.js --name groupbot
  pm2 save && pm2 startup
  ```
- **nohup / background:**
  ```bash
  nohup node dean.js > bot.log 2>&1 &
  ```
- **macOS `launchd`** or **systemd** (Linux) if you want an OS-managed service that restarts on crash/boot.

On a headless server, run Puppeteer without a display (pass `--no-sandbox` args in the `puppeteer` options) or use `xvfb`.

---

## Security & secrets

- **No secrets or machine paths are hardcoded in the source.** The Gemini API key, the group id, and the optional browser/session paths all live in `env.json`.
- `env.json` is **gitignored**, along with the WhatsApp session (`session/`, `.wwebjs_auth/`, `.wwebjs_cache/`) and the runtime data files (`quiz.json`, `response.json`). See [`.gitignore`](file:///Users/rohanbhoi/Desktop/GroupBot/.gitignore).
- `quiz.json` and `response.json` are kept out of version control because they contain participant names and phone-number ids.
- Never commit `env.json`. If a key is ever exposed, rotate it in Google AI Studio.

---

## Known limitations

- **No CRON / no persistence of schedules** — restarting the process clears pending `setTimeout` timers (the schedulers re-arm on startup, but in-flight sends for the current window may be missed).
- **`answerTime` is not enforced** — it is stored in `quiz.json` but no timer currently closes answering after that many seconds; answers are instead bounded by `maxResponse`.
- **Exact-match grading** — an answer must equal the quiz answer after trim + lowercase; typos/spelling variants are not accepted.
- **Delivery window is same-day only** — it does not wrap past midnight.
- **Answer matching is by reply** — a correct word typed as a standalone message (not a reply to the question) is ignored.
- **No leaderboard generator included** (see [Leaderboard](#leaderboard)).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Cannot find module 'whatsapp-web.js'` / `@google/genai` / `qrcode-terminal` | Run `npm install` or extract `node_modules.tar.gz`. |
| `env.json not found` warning | Create `env.json` from the [config section](#configuration-envjson). |
| Browser fails to launch | Install a Chromium-based browser, or set `browserExecutablePath` in `env.json` (leave it out to use Puppeteer's bundled Chromium). |
| QR never appears / login loop | Delete `session/` and re-run to force a fresh QR scan. |
| `env.json: ...` error | Field missing or malformed — see the [config table](#configuration-envjson). |
| `deliveryEnd must be later than deliveryStart.` | Ensure `deliveryEnd` is after `deliveryStart` (same-day window). |
| Questions never sent | Confirm `groupId` is set correctly and the process is still running with the delivery window not yet passed today. |
| Answers not recorded | Replies must be **quoted replies to the question** and exactly match the answer; also check `maxResponse` isn't reached. |
| No leaderboard output | No generator ships with the repo — use the [snippet](#leaderboard) on `response.json`. |
