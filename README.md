# SignalLedger

Fresh Signalpost company-research agent, created October 7, 2026 using Codex. No code from previous competition entries or the organizer's reference starter was reused. Deterministic extraction, no LLM, keys, paid APIs, wallets or cloud billing.

## Run

Node.js 24+, network access to the documented public sources.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
node cli.mjs --input companies.jsonl --output out --websites --concurrency 3
npm start
```

Evaluator command is the single `node cli.mjs` command above after dependency installation. Inputs are a JSON array, JSONL or newline-separated organisation numbers. Object keys accepted: organisation_number, organisasjonsnummer, orgnr, org_number. Every input position produces a terminal envelope, including invalid/blocked/failed companies. `out/envelopes.jsonl` is machine output; `out/profiles.json` is the inspection dataset.

`npm run smoke -- --websites` downloads and verifies both organizer-published SHA-256 hashes, then researches 100 evenly spaced company numbers from the published file. This is a completion test, not a random sample, independent accuracy evaluation, official score or qualification claim.

UI: http://127.0.0.1:3288 . Set PORT to use a different free loopback port, DATA_DIR to choose a collected directory. The UI only inspects results and reloads completed data; it does not silently launch a collection job. Use the CLI separately for background collection and refresh. The collector refuses concurrent writers to the same output directory. An interrupted process may leave .collect.lock; verify no collector is active before manually removing that lock.

## Architecture

```text
Supplied input numbers -> checksum validation -> bounded worker queue
  -> live legal identity (Brreg)
  -> annual accounts (exact ID, currency, reporting period, entity/group)
  -> registered roles (birth dates removed before persistence)
  -> registered workplaces (first 100, total/truncation disclosed)
  -> optional registry-linked website (public DNS, robots, exact ID)
  -> content-addressed snapshots + claim evidence + refresh differences
  -> one terminal envelope per input + run report + local inspection UI
```

## Sources And Rights

- Bronnoysundregistrene entity, role and subunit APIs: https://data.brreg.no/enhetsregisteret/api
- Annual-account API: https://data.brreg.no/regnskapsregisteret/regnskap ; documented open government data: https://data.norge.no/en/datasets/7c87f169-2520-4e56-ba2a-b7a3cc7de2e9/regnskapsregisteret
- Organizer universe: https://builderr.ai/signalpost-company-universe-2025.jsonl.gz
- Source policy: https://builderr.ai/starter-briefs/signalpost-sources.md

Official data is available under Norwegian Licence for Open Government Data where specified by the provider. Attribute Bronnoysundregistrene and retain source links/date on exported claims. Company website copyright and access terms remain the company's; robots permission alone is not a licence. Website snapshots are local evidence, not licensed republishing material. Review source rights before publicly redistributing them. Full collected data/snapshots are ignored by Git and excluded from the approved source publication.

Outbound collector accepts credential-free HTTPS/443 only, validates all DNS answers as public, pins the socket to validated addresses, caps response sizes and request duration, and never signs in or bypasses blocks. Website redirects are not followed without new robots verification; therefore redirected sites are currently marked blocked. Third-party/social scraping is not implemented. A domain from a registry is only a candidate: website facts are published only when the checked page contains the exact organisation number. Source timestamps indicate retrieval, not the financial reporting period.

## Limits

Financial records may lag the registry's latest-filed year. Do not present older accounts as current accounts. All returned periods and group/entity scopes remain visible. No guessing, absent-to-zero conversion, employer reputation/sentiment inference or investment recommendation. Registered workplace collection is capped at 100 per company. Hiring and dated website news are explicitly unqueried in this version, not inferred absent. A failed refresh cannot prove a fact was removed; prior evidence is preserved in full previous-run archives, unavailable comparisons are flagged.

No reference set is available locally for measuring company/fact precision and recall. The official 65/100 qualification threshold is unmeasured and is assessed by Builderr after submission, not claimed as an entry prerequisite. The exact evaluator resource budget, frozen identity snapshot format and final output schema are supplied by Builderr. This implementation currently anchors identity to live Brreg records; official frozen-snapshot compatibility is not yet tested. Request these official-run details with the entry and verify any required adapter before a scored run. Completion of a 100-company smoke test does not guarantee completion of every official batch under its budget.

The prepared source candidate includes `evidence/smoke-report.json` and `evidence/universe-provenance.json`: summary completion/provenance evidence only, without company/person claims or downloaded source snapshots. Full local artifacts remain in the private ignored `out` directory.

Dependencies are pinned in package-lock.json. SignalLedger's original source is licensed under MIT; see LICENSE. Third-party licence notices must remain in their packages; see THIRD-PARTY-NOTICES.md. The MIT license does not relicense collected data or company website content. Monetary API cost per local and official run is $0 for this implementation; evaluator compute, bandwidth and hosting resources are separate and supplied by the organizer, not purchased here.

Published requirements inspected on October 9 do not state a Bahrain exclusion or team-size minimum, but adult Bahrain solo prize eligibility and a non-PayPal payout method have not been confirmed by the organizer. No payout or qualification guarantee is made. Official schema, frozen identity and resource-limit compatibility remain unverified as stated above.
