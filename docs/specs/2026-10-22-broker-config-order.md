# Broker configuration initialization

Issue: #38.
The curation scripts capture the broker URL during static import, before their external environment file is loaded.
Resolve the destination after loading configuration and reject invalid explicit origins before credential-bearing requests.

## Scope

Use one resolver across curate-source, curate-brand, research-brand, transcribe-brand, and research-missing.
Keep the existing environment-file loader and process-environment precedence.
Missing or whitespace-only values use http://localhost:3000.
Accept HTTP(S) origins without embedded credentials, non-root paths, query strings, or fragments.
Normalize a trailing slash so endpoint concatenation remains correct.
Errors must not echo configuration values that could contain credentials.

## Acceptance

- A URL loaded after module import controls all source curation requests.
- Each CLI resolves the destination after loadSecrets and before credential-bearing work.
- Invalid explicit values fail before any fetch or database client is used.
- Environment, file, missing, empty, and invalid configuration cases have regression coverage.

## Constraints

Do not contact real brokers, providers, or databases during tests.
Do not change research-run model/default handling tracked separately in #47.
Do not change #49 interpretation behavior or close it while its demonstrated blockers remain.
No UI or schema change is involved.
