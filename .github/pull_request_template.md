## Summary
- Describe what changed and why.

## Source curation checklist
- [ ] I ran `npm run compile:sources`
- [ ] I ran `npm run check:sources:freshness`
- [ ] I ran `npm run check:sources:hints`
- [ ] I documented replacement/removal rationale for risky or dead endpoints

## Validation
- [ ] I ran `npm run validate:feed-data`
- [ ] I ran `npm run validate:live-feed-output` (if feed output changed)
- [ ] I ran `npm test`

## Operational impact
- [ ] No user-facing behavior change
- [ ] User-facing behavior changed (describe below)

### Notes
- Add rollout, guardrail, or follow-up notes.
