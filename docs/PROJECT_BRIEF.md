# CareLayer: Project Brief

## 1. What CareLayer is

CareLayer is an open network of verified health workers that any AI health agent can call and pay per answer, using x402 agentic payments in USDC on Stellar.

Built for the **EmpowerHer: Building the Agent Economy** hackathon (women-focused, agentic payments on Stellar with x402). **Submissions close 28 November 2026.**

### Problem

- Nigerian women have health questions (pregnancy, periods, contraception, sexual health) they are embarrassed to ask in person.
- AI assistants can explain a lot but cannot take responsibility for advice.
- Services like Ask Without Shame, Kangpe and Jacaranda Health prove women want answers from real health workers, but each runs its own closed service.

### Solution

- Women ask an AI assistant.
- When a question needs a professional, the assistant (with her consent) sends it to a pool of verified nurses, midwives and doctors.
- A health worker answers. The agent pays per answer over x402. The health worker is paid instantly.
- Any agent can use the network: our web app, Claude via our MCP server, or other apps.

## 2. Users

| User           | App                           | What they do                                                                                          |
| -------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Women          | `apps/web` (mobile-first PWA) | Ask questions, get AI answers free, pay only for health worker answers.                               |
| Health workers | `apps/workers`                | Registered nurses, midwives and doctors in Nigeria, any gender. Answer questions and earn per answer. |
| Admin (us)     | Internal page                 | Approve health worker licences.                                                                       |

## 3. Core flow (women)

1. She chats with the AI assistant in her own words. **AI answers are free.**
2. If a professional is needed, the assistant offers to send the question, showing:
   - price
   - free answers remaining
   - optional "prefer a female health worker"
   - **Send** / **Not now**

   She can also choose **"Ask a health worker directly"** at any time.

3. On consent, the question is sent.
   - The assistant **cleans up spelling and grammar but NEVER summarises or shortens** it.
   - Store **both** the original and the cleaned version.
   - The assistant may add separate **"assistant notes"**.
   - The AI assigns a category: **Pregnancy, Periods, Contraception, Sexual health, General**. Women never choose categories.
4. Health workers see the question. One claims it and answers.
5. **Pay on delivery:** she is charged only when the answer is ready. Her **first 3 answers are free**.
6. She sees the answer with the health worker's name, role and verified status.
   - **Never expose health worker contact details.**
   - **Women stay anonymous to health workers**, who see only the details needed to answer.

## 4. Emergencies

- Every message is checked for red-flag symptoms **first**, using a fixed list (`apps/api/config/red-flags.json`) plus the LLM.
- If triggered:
  - show an emergency response immediately
  - **free**
  - **nothing sent to the queue**
  - emergency call options and help finding the nearest hospital
- **Emergency numbers must be verified before the demo.**

## 5. Payments (Stellar testnet, x402, USDC)

### Wallets

- Every user gets a **custodial Stellar wallet** created automatically at sign-up. They never see keys.
- Balances are shown in **naira**; the underlying asset is USDC.

### Top-up

- Paystack in **TEST mode** (card, bank transfer, USSD).
- On a successful test payment, credit test USDC to her wallet.
- In production this would go through a Stellar anchor.

### x402 pay-on-delivery

| Endpoint                    | Cost               | Purpose                                             |
| --------------------------- | ------------------ | --------------------------------------------------- |
| `POST /questions`           | free               | Creates the question, returns id + price.           |
| `GET /questions/:id/status` | free               | Returns `open` / `claimed` / `answered`.            |
| `GET /questions/:id/answer` | **x402-protected** | The agent pays when it fetches the finished answer. |

A **guard runs before the payment middleware** so unanswered questions never request payment.

### Split and limits

- **Health worker 80%, platform 20%.** Example: a ₦500 answer pays the health worker ₦400.
- Free answers are still paid to the health worker from the treasury.
- A **spending limit per answer**, set by the woman. Anything above needs her approval.

### Withdrawals

- Health workers withdraw to a Stellar address (real testnet payment, requires a fresh email code).
- Bank withdrawal is "coming soon".
- **Women's wallets have NO withdraw feature** for now.

### Facilitator

- Coinbase x402 facilitator **or** the OpenZeppelin relayer x402 plugin on Stellar testnet.
- Use the official x402 Stellar packages and **check their current docs** before writing code.

## 6. Health workers

### Sign-up and onboarding

- Sign up with full name as on their licence + email, or Google.
- Onboarding collects:
  - role (nurse / midwife / doctor)
  - full name confirmation
  - main area of practice
  - years of practice
  - licence number
  - document uploads: practising licence, certificate of registration, government ID, selfie with ID
  - payout wallet (auto-created, optional own Stellar address)
  - agreement to give **guidance, not diagnosis**

### Verification

- **Manual by admin** for the hackathon.
- Nurses and midwives: Nursing and Midwifery Council of Nigeria.
- Doctors: Medical and Dental Council of Nigeria.
- **Only approved workers can claim.**

### Claiming

- One question at a time.
- 10-minute lock with countdown.
- Release option.
- Expired claims return to the open list.

### Topics and availability

- "Topics I answer": chosen categories control **alerts** (all open questions stay visible). At least one required.
- Defaults: midwives get Pregnancy + Periods; nurses and doctors get all.
- An **Available** toggle controls alerts.
- Answered questions can be viewed read-only.

## 7. Auth (both apps): passwordless

- Google sign-in, or email + 6-digit code. **No passwords.**
- Separate **Sign up** and **Log in**. Sign up asks for a name:
  - women: "What should we call you?"
  - health workers: "Full name as on your licence"
- **Code:** 6 digits, 10-minute expiry, single use, stored hashed, max 5 attempts, resend rate-limited.
- **Sessions:**
  - ~15-minute access token
  - refresh token in an httpOnly, Secure, SameSite cookie (~90 days women, ~30 days health workers)
  - sliding expiry, rotation on every refresh, reuse detection
  - a sessions table with device name, last used and revoked
  - Log out and "Log out of all devices"
- **Fresh code required** before withdrawals or payout address changes.
- **Test early:** on iPhone, the home-screen PWA may have separate storage from Safari.

## 8. Privacy and safety features

- **Quick exit:**
  - one tap calls `window.location.replace()` to a harmless site (Google by default; options: Google, a weather site, a news site)
  - Back must not return to CareLayer
  - does **not** log out
  - the next open shows a blank new chat
  - Esc twice triggers it on desktop
- **Appearance:** System (default) / Light / Dark, in both apps and on the website.
- **Add to Home Screen:** Android install prompt; iPhone step-by-step instructions.

## 9. MCP server (`apps/mcp`)

Lets a woman use CareLayer inside Claude.

- Tools:
  - ask a health worker (requires explicit confirmation of the price)
  - get the answer
  - check balance
- Payments come from her CareLayer wallet within a **separate Claude spending limit**, with an "ask me before each payment" option.
- Emergencies get the same free response.

## 10. Out of scope for the hackathon

- Real licence verification APIs
- Mainnet
- Real naira on/off-ramp
- Bank withdrawals
- Women's withdrawals
- Passwords
- Native mobile apps

## 11. Team and tasks

### Zainab (backend + payments)

`apps/api`, database, passwordless auth + sessions, Stellar wallets, Paystack test top-up to test USDC, x402 endpoints and pay on delivery, 80/20 payouts, claim locking, health worker onboarding + admin approval, earnings + withdrawals, LLM integration, deployment, `apps/mcp`.

### Hikmah (tokens + frontend + AI behaviour)

`packages/tokens/tokens.css`, `apps/web` (landing page + women's app) and `apps/workers`, theme switching, PWA, quick exit, Add to Home Screen, mock API for frontend work; the assistant system prompt (`apps/api/prompts/assistant.md`), the red-flag list (`apps/api/config/red-flags.json`) and a test set of example questions.

### Both

- Agree the API contract first ([API_CONTRACT.md](API_CONTRACT.md)).
- Daily 15-minute check-in.
- End-to-end testing, demo, pitch and submission.

The step-by-step task guide lives in `docs/TASKS.md` (added separately).
