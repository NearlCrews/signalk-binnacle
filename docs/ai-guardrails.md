# AI assistance guardrails

Binnacle surfaces AI-generated content from the signalk-openrouter-companion plugin: analyzer
reports that arrive as ordinary Signal K notifications. These rules bound how that content may be
used, and they are design constraints, not preferences.

## The plugin owns the model

- No API key is ever held, entered, or stored in the browser. The companion plugin holds the
  OpenRouter credential server-side, spends against its own daily budget, and Binnacle only reads
  the notifications it publishes and fires its Signal K PUT triggers.
- Binnacle never calls a language model directly, from the page or from its worker.

## LLM text never enters a safety path

- Alarm decisions, alarm copy, live-region announcements, and the collision, anchor, depth, and
  off-course logic consume only deterministic data. A companion report is advisory prose rendered
  in its own panel and quoted, timestamped, in the watch handoff; it never becomes an alarm and is
  never paraphrased by another model.
- Report text renders as text. It is bounded at ingestion and never interpreted as markup,
  navigation data, or instructions.

## The UI never blocks on a cloud call

- Every companion surface is populated from data already on the boat (the notification tree and
  the live stream). A fire-now trigger returns immediately with the plugin's own acknowledgment
  (started, already running, or budget exhausted), and the report lands whenever the plugin
  publishes it.
- Offline, the last published reports stay readable; nothing spins waiting for a model.

## Honesty rules

- AI-derived content is labeled as advisory and shows when it was produced.
- Budget refusals from the plugin are shown verbatim rather than retried silently.
- Deterministic computations (the passage debrief, trend annotations) are computed client-side
  and are never attributed to the model; a companion narrative may sit beside them, clearly
  attributed, never replacing them.
