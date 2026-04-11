# Brialert operations runbook

## 1) Stale feed in UI
- Check latest `Update live feeds` workflow run status.
- If successful, confirm `live-alerts.json` has a recent `generatedAt` and `health.lastSuccessfulRefreshTime`.
- If stale, trigger a manual run and confirm the UI `Refresh feed` path reports a newer timestamp.
- If the run warns about guardrails, inspect `runMetrics.guardrails.violations` and reduce failing source load before retrying.

## 2) Source outages / high failure rate
- Inspect `data/source-remediation-sweep.json` and `data/top-20-source-remediation.json` for category hotspots.
- Review `data/build-observability-summary.json` for failing lanes/kinds and guardrail violations.
- Temporarily quarantine repeatedly dead/blocked sources, then rebuild feed.
- For persistent host-wide outages, reduce scheduler pressure and retry after cooldown windows.

## 3) Quarantine restore failures
- Confirm admin login succeeds at `/api/auth/session`.
- Verify restore requests come from an allowed frontend origin (`BRIALERT_ALLOWED_ORIGINS`).
- Check restore API response payload (`error`, `message`) and audit events prefixed with `[admin-audit]`.
- If duplicate conflict occurs, update the candidate endpoint so it does not collide with an existing active source.
