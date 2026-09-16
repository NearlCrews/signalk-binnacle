# AI assistance guardrails

Binnacle's **AI advisor** displays reports from `signalk-openrouter-companion`, an optional Signal K
plugin. Reports are advisory descriptions of telemetry, not navigation instructions, maintenance
diagnoses, or evidence that a system is safe. These boundaries also apply when a report is included
in a watch handoff.

## Model access and privacy

Binnacle does not request, store, or transmit an OpenRouter API key. The companion plugin holds its
credential on the Signal K server, chooses the telemetry and model, and enforces its configured call
budget. Binnacle never calls a language model directly from the page or its worker.

**Run now** asks the plugin to analyze its configured vessel telemetry. That can send data through
OpenRouter to the selected model provider and use shared paid credits. Before running, review the
plugin's telemetry, prompt, model, budget, and provider privacy settings. A local Signal K server does
not make this analysis local-only. Binnacle does not inspect the plugin's complete outgoing prompt or
guarantee that sensitive vessel information has been omitted.

**Refresh reports**, opening the panel, and its periodic refresh only read reports already published
on Signal K. They do not request a new analysis. The plugin can also run on its own schedule;
closing Binnacle, closing AI advisor, or erasing browser data does not stop that server-side schedule.
Disable or configure the analyzer in Signal K when its data sharing or cost is unwanted.

## Report loading and confidence

Binnacle reads the plugin's report notifications through the standard Signal K v1 API at
`vessels/self/notifications/openrouter-companion`. The panel refreshes when opened and about once per
minute while visible. It does not use the plugin's administrator-only report routes.

The panel distinguishes:

- an initial report check;
- an available report collection with no reports yet;
- no report branch, which can mean the plugin is absent or has not published since Signal K restarted;
- a failed read, with previously received reports retained and a **Retry** action; and
- a provider-published **Report unavailable** entry, which is not standing advice.

Reports show their analyzer and production date, time zone, and age. Missing or invalid timestamps
display **Report time unknown**. A future timestamp says its age is unknown instead of appearing
fresh. A recent publication time does not prove that all telemetry in the report was current or
complete; verify the inputs and the vessel's present condition.

Reports remain in memory across panel changes and failed refreshes. They are not a durable browser
report archive. If Signal K is unreachable after a page reload, Binnacle cannot promise to recover
the last report. Signal K's notification tree can also be empty after a server restart until the
plugin publishes again.

## Run outcomes and recovery

Running an analyzer requires Signal K read and write access. A read-only display can still read
reports and offers a direct access request. On-demand runs use the standard v1 PUT path
`vessels/self/plugins/openrouter-companion/{analyzerId}/run`; the device token does not grant access to
the plugin's administrator configuration.

**Running** remains visible while the client waits for the Signal K request's terminal acknowledgment.
A pending acknowledgment is not success. Binnacle follows only the same-origin Signal K request-status
route, polls for up to three minutes, and prevents a second run of that analyzer from this display
while the first request is pending.

The final message distinguishes a completed request, a server refusal such as an exhausted budget,
denied access, unsupported on-demand operation, and an unconfirmed outcome. Bounded server refusal
text is shown beside the action; refusals are not silently retried. Completion means the request
finished, not that its report or diagnosis is correct. Binnacle then refreshes the report collection.

If the outcome cannot be confirmed, the analyzer may still be running on the server. Check the report
before trying again. Closing the panel does not cancel the server run or release the pending-run
guard. A result received while the panel is closed remains available when it reopens; action messages
expire after a short visible interval. Leaving or reloading Binnacle stops its local polling but does
not cancel the server's analysis.

## Safety and presentation boundaries

Binnacle's own collision, anchor, depth, off-course, and MOB calculations do not consume companion
prose. An advisor report cannot write a route, alter an autopilot setting, change an alarm threshold,
or become a navigation command. Report content renders as bounded plain text, never executable
markup or instructions. The client accepts at most 64 analyzers and 8,192 characters per report.

The quiet report surface is separate from provider-generated Signal K alarms. A companion analyzer
can publish a separate alarm-grade notification; Binnacle handles that notification through its
ordinary Alarms system, including the provider's message and declared severity. Such a provider alarm
may depend on a successful cloud call and available budget. Do not rely on it as the sole equipment
or navigation safety alarm, and do not assume its text came from Binnacle's deterministic monitors.

The watch handoff may include the first line of the newest standing report as a direct, shortened
quote. It leads with the advisory label and report age, or the unknown-time qualification, before the
analyzer name and text. Report-unavailable entries are excluded. The snapshot keeps the qualification
captured at handoff time; it does not turn an old report into current advice or ask another model to
paraphrase it.

Deterministic passage debriefs and trend annotations remain distinct from model output. Review the
underlying readings, their units, source, and freshness whenever advisory prose could affect a
decision.
