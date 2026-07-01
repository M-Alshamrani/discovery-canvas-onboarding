# Dell Discovery Canvas

A browser-based workshop tool for Dell presales engineers. It captures a customer's
current IT setup, the future state they want, and the gaps between the two — then turns
that into a phased roadmap you can walk through with the customer.

Everything runs in your browser. Your data stays on your machine (auto-saved in the
browser, or exported to a file you control). There is no backend and no build step — the
app is plain JavaScript served as static files.

---

## Run it

Two ways. Both serve the same files; pick whichever is easier for you.

**Python (simplest, for working on it locally)**
- Windows: double-click `start.bat`
- macOS / Linux: `./start.sh` (run `chmod +x start.sh` once, the first time)
- Or directly, from this folder: `python -m http.server 8000`, then open <http://localhost:8000>

**Docker (for a shared deployment)**
```
docker compose up -d --build
```
Then open <http://localhost:8080>. Stop it with `docker compose down`.

You need Python 3.10+ for the first option, or Docker for the second. Nothing else to install.

---

## The screen

A top bar (customer name, the two AI buttons, a light/dark toggle), five step-tabs, and a
footer with file actions. You generally work left to right through the tabs:

- **Context** — who the customer is (name, vertical, region) and the **business drivers**
  that matter to them, plus their **environments** (data centers, clouds, sites).
- **Current state** — what they run today, shown as a grid of technology by environment
  and layer. Compute, storage, and data-protection items can also carry end-of-sale,
  end-of-support, and end-of-service-life dates, which feed into risk scoring and reporting.
- **Desired state** — what they want to run. Each item links back to a current item with a
  disposition: keep, enhance, replace, consolidate, retire, or introduce.
- **Gaps** — the differences worth acting on. Each gap ties to a driver, has a type and an
  urgency (High / Medium / Low), and a phase: Now, Next, or Later.
- **Reporting** — read-only views to present back to the customer: Overview, Heatmap,
  Gaps Board (a kanban), Vendor Mix, Roadmap, and Export report (a standalone HTML file
  you can download or open and print to PDF).

Click the `?` icon on any tab for page-specific help.

---

## The AI features

The app talks to an AI provider you configure in **Settings** (the gear icon). It supports
OpenAI-compatible endpoints (including self-hosted vLLM), Anthropic (Claude), and Google
Gemini. Your API key is stored in your browser only and never leaves your machine except to
call the provider you chose.

- **AI Assist** — a chat that also serves as the app's built-in **help center**. Ask it how
  to do something in the app, or ask about the data you've loaded. It is *grounded* in your
  canvas, so it answers from your real data instead of making things up. When it gives
  outside analysis (for example, competitive positioning), it marks that part with a small
  "Beyond the canvas" note so you know it is reasoning past your data. Open it with the
  **AI Assist** button or Cmd/Ctrl + K.
- **AI Notes** — a workshop note-taker. Type rough bullets during a session; it structures
  them and suggests entries to add to the canvas, which you review before applying. Open it
  with the **AI Notes** button or Cmd/Ctrl + Shift + N.
- **Skills** — small, saved AI helpers you build in the Skill Builder and run against your
  data (for example, "suggest Dell products for this gap"). You can author your own.

The AI features need a provider key to return live answers. The rest of the app works
without one.

---

## Saving, opening, sharing

- The app **auto-saves to your browser** as you work (see "Auto-saved to browser" in the footer).
- **Save to file** writes a `.canvas` file you can re-open later or hand to a colleague.
- **Open file** loads a `.canvas` file back in.
- **Import data** brings in items from an external source.
- **Load demo** loads an example customer ("Meridian Heritage Development Authority (MHDA)") so you can explore.
  **New session** starts empty. **Clear all data** wipes the browser copy.

---

## Where to go next

Read **[ARCHITECTURE.md](ARCHITECTURE.md)** for how the code is organized and how the data
model works — start there before you change anything. **[REVISION_HISTORY.md](REVISION_HISTORY.md)**
is the short story of how the app got to where it is.
