# CheapGroceries

**Live app:** https://cheapgroceries.app.space

CheapGroceries analyzes your digital grocery receipts from Gmail (or pasted receipt text) to find **live cheaper local store swaps**, track **item-level price increases**, discover **nearby stores from your ZIP code**, pull **live weekly ads**, and calculate when grocery **memberships actually beat their annual fees** (net of shipping and extra-trip thresholds).

---

<img width="1512" height="859" alt="image" src="https://github.com/user-attachments/assets/b19105ad-1010-4a46-a382-a8b44ad3525c" />

<img width="1512" height="859" alt="image" src="https://github.com/user-attachments/assets/fe9bade7-5678-4d1d-aef3-b0139d245c4f" />

<img width="1512" height="859" alt="image" src="https://github.com/user-attachments/assets/830d6661-8eb9-46ca-bd4b-29064b5bd782" />


## Key Features

- **Gmail Receipt & Membership Sync:** Connects per-user Google OAuth (`google/gmail-list`, `google/gmail-get`) to import digital receipts from Target, Walmart, Instacart, Amazon, Costco, and regional grocers while auto-detecting active memberships (Amazon Prime, Target Circle 360, Costco, Walmart+, Instacart+, Sam's Club).
- **Structured Receipt Extraction:** Uses owner-billed Claude Haiku (`createDeepSpaceAI(env, 'anthropic')`) + Zod boundary schemas to parse messy multi-line retailer HTML emails into integer-cent line items (with a fast deterministic parser for plain-text pasted receipts).
- **Dynamic Local Store Discovery:** Calls `serpapi/places-search` when you set a ZIP code to discover actual grocery chains near you and resolve your city/state—zero hardcoded regional store tables.
- **Live Price Verification & Apples-to-Apples Guardrails:** Background jobs (`AppJobRoom`) run concurrent batches against `serpapi/search` (`google_shopping`), `amazon/search-products`, and `exa/search` failover with:
  - Dietary/quality parity (e.g., never swaps Organic → non-organic)
  - Ground-meat lean-ratio parity (e.g., never swaps 93/7 → 73/27)
  - Pack-size / weight bounds (never recommends a smaller package as "cheaper")
  - Net-of-shipping & extra-trip worth-it thresholds
  - Per-job circuit breakers on upstream `429` / credit exhaustion
- **Verifiable Subscription Math & Price-Increase Tracking:** Computes real break-even math using published fees/discounts (Amazon Subscribe & Save 5%/15%, Amazon Prime $139/yr vs. live Amazon swaps, Target Circle Card 5%) scaled to your actual receipt date cadence, and surfaces repeat items whose prices went up across trips.

---

## DeepSpace Primitives & Integrations

| Layer | Implementation |
|---|---|
| **Integrations** | `google/gmail-list`, `google/gmail-get` (`billing: 'user'`), `createDeepSpaceAI` (Anthropic Claude Haiku), `serpapi/places-search`, `serpapi/search` (`google_shopping` & `google`), `amazon/search-products`, `exa/search` |
| **Data & RBAC** | DeepSpace Records (`households`, `team_members`, `receipt_scans`, `receipt_lines`) scoped with `'team'` RBAC; shared `sku_swap_cache` (ZIP-scoped for physical stores, global for Amazon) with client writes denied |
| **Background & Scheduled Work** | `AppJobRoom` (`src/jobs.ts`) for parallelized live price lookups; `AppCronRoom` (`src/cron.ts`) for weekly stale cache refresh |
| **Frontend & Routing** | React 19, Tailwind v4 (`market` receipt-paper theme), custom hooks (`src/hooks/`), static prerendered landing page (`/`) |

---

## Project Structure

```text
worker.ts                    # Cloudflare Worker + Durable Object assembly
src/
  actions/index.ts           # Server actions (processReceipt, updateHouseholdLocality, etc.)
  jobs.ts                    # AppJobRoom background live-price verifier + circuit breaker
  cron.ts                    # AppCronRoom weekly stale-cache refresh
  schemas/                   # Collection schemas + RBAC rules
  lib/                       # Pure domain logic (money, locality, live-price-matcher, deals-engine, email-parser, receipt-parser)
  hooks/                     # useSavingsSummary, useReceiptImporter
  components/                # SavingsView, ScanReceiptModal, SwapRow, Navigation
  pages/                     # Static landing (/), /home, /receipts
tests/
  smoke.spec.ts              # Static contract, SEO, routing
  api.spec.ts                # Auth proxy & WebSocket checks
  collab.spec.ts             # 2-user sign-in & RBAC tenant isolation
```

---

## Local Development & Verification

```bash
npm install
npm run dev                  # Starts local DeepSpace dev server (http://localhost:5173)
```

### Quality Gates
Code quality is enforced with `tsconfig.json` `"strict": true` and TigerStyle-inspired ESLint rules (`--max-warnings 0`, `max-len: 100`, `max-lines-per-function: 70`, `max-depth: 3`, `complexity: 15`, `curly: all`, `no-nested-ternary`):

```bash
npm run validate             # tsc --noEmit + Vitest unit tests (11 tests)
npm run lint                 # Strict ESLint (--max-warnings 0)
npm run build                # Worker + Client + Static prerender build
npx deepspace test run all   # Unit + Playwright smoke, API, and 2-user RBAC E2E tests (10 tests)
```

---

## Key Tradeoffs

- **Digital receipts over paper photo scanning:** Paper OCR/OpenCV scanning was cut after testing in favor of zero-friction Gmail receipt sync and plain-text paste.
- **Direct retailer links over an in-app Swap Cart:** Replaced a separate cart page with direct `Shop [Store] →` links and one-click dismiss.
- **No LLM-guessed prices or heuristics:** Removed LLM cross-store price estimates and guessed bulk-savings percentages; every displayed swap price is backed by a live merchant listing or omitted.
