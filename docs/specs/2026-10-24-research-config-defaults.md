# Research runner configuration defaults

## Problem

Issue47 reports that empty optional values in the external environment file bypass the research runner's nullish defaults.
The runner must validate settings before sending a broker request or starting Codex.

## Contract

Missing, empty and whitespace-only broker and model settings use the existing defaults: http://localhost:3000 and gpt-5.6-terra.
Explicit surrounding whitespace is trimmed.
Broker URLs follow the existing getBrokerBaseUrl policy: HTTP(S) origin only, no credentials, path prefix, query or fragment, with a trailing slash accepted.
Models remain opaque CLI identifiers rather than a fixed model registry.
Accept an identifier beginning with an ASCII letter or digit and containing only letters, digits, dots, underscores, colons, slashes and hyphens.
Reject malformed settings without echoing their values and before any external call.
Existing process environment precedence and secret isolation remain unchanged.

## Scope and non-goals

Reuse the existing broker helper with an optional environment argument and add one pure runner-settings parser.
Change only the single-food research runner's configuration consumption, its regression tests, environment example and directly related documentation.
Do not change other entrypoints' model handling, credential storage, URL fetch policy, database behavior or the default model.
No visual approval is applicable.

## Acceptance

Pure parsing tests cover undefined, empty, whitespace, valid, trailing-slash and malformed values.
Runner subprocess tests observe the actual first broker request and prove malformed settings fail before that boundary.
Tests never call a real broker, launch Codex or read real secrets.
