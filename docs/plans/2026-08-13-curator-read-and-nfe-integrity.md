# Curator Read and NFE Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent non-curator sessions from loading private server-rendered draft data and reject guaranteed-analysis totals over 100% when carbohydrate is stated explicitly.

**Architecture:** Keep the proxy limited to session refresh and broad `/new` login routing. Reuse one human-session authorization function from each sensitive server page before invoking its service-role loader, while preserving automation-secret authorization for APIs. Extend the existing pure domain validation sum only with explicitly supplied `carb_pct`; never add inverse-derived NFE to the sum.

**Tech Stack:** Next.js 16 App Router server components, Supabase SSR Auth, TypeScript strict, React 19, and Vitest.

## Global Constraints

- Keep public APIs stable and keep automation-secret API authorization unchanged.
- Keep Korean UI strings and comments in Korean and keep identifiers in English.
- Do not add dependencies, migrations, generated-type changes, package changes, or public UI changes.
- Use `supabase.auth.getUser()` for the human email allowlist because the authorization decision requires the current Auth user record. Do not trust `getSession()` for authorization.
- Do not move the service-role client into a client component or expose private loader output before authorization succeeds.
- Write and verify each failing test before editing its production behavior.
- Do not stage, commit, or push until the operator explicitly requests it.

---

## File Structure

| File                                   | Responsibility                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/admin-auth.ts`                | Share the allowlisted human-session decision between API and server-page authorization without changing automation-secret behavior. |
| `src/lib/admin-auth.test.ts`           | Pin missing configuration, missing user, unlisted user, and allowlisted human outcomes.                                             |
| `src/app/new/review/page.tsx`          | Authorize a human curator before loading publication-review drafts.                                                                 |
| `src/app/new/review/page.test.tsx`     | Prove denied requests cannot invoke the private publication loader.                                                                 |
| `src/app/new/transcribe/page.tsx`      | Authorize a human curator before loading pending label transcripts.                                                                 |
| `src/app/new/transcribe/page.test.tsx` | Prove denied requests cannot invoke the private transcript loader.                                                                  |
| `src/lib/domain.ts`                    | Include explicitly stated NFE in guaranteed-analysis total validation.                                                              |
| `src/lib/domain.test.ts`               | Pin stated-NFE rejection and derived-NFE compatibility.                                                                             |

---

### Task 1: Share the Human Curator Decision

**Files:**

- Create: `src/lib/admin-auth.test.ts`
- Modify: `src/lib/admin-auth.ts`

**Interfaces:**

- Consumes: `createClient()` and `ADMIN_EMAILS`.
- Produces: `authorizeHumanCurator(): Promise<HumanCuratorAuthorization>`.
- Preserves: `authorizeCurator(request: Request): Promise<CuratorAuthorization>` with the automation-secret branch evaluated first.

- [x] **Step 1: Write the failing human-authorization tests**

Create `src/lib/admin-auth.test.ts` with a complete Auth response double and literal expected results.

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

import { authorizeHumanCurator } from "./admin-auth";

describe("authorizeHumanCurator", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    mocks.getUser.mockReset();
    process.env.ADMIN_EMAILS = "curator@example.com";
  });

  afterEach(() => {
    if (originalAdminEmails === undefined) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = originalAdminEmails;
    }
  });

  it("설정된 관리자 이메일이 없으면 인증 서비스를 호출하지 않는다", async () => {
    process.env.ADMIN_EMAILS = "";

    await expect(authorizeHumanCurator()).resolves.toEqual({
      kind: "denied",
      status: 503,
      message: "ADMIN_EMAILS is not configured.",
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("로그인 사용자가 없으면 401을 반환한다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(authorizeHumanCurator()).resolves.toEqual({
      kind: "denied",
      status: 401,
      message: "관리자 로그인이 필요합니다.",
    });
  });

  it("허용 목록에 없는 로그인 사용자를 거부한다", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "visitor-id", email: "visitor@example.com" } },
      error: null,
    });

    await expect(authorizeHumanCurator()).resolves.toEqual({
      kind: "denied",
      status: 403,
      message: "카탈로그 편집 권한이 없습니다.",
    });
  });

  it("허용 목록의 이메일은 대소문자와 공백을 정규화해 승인한다", async () => {
    process.env.ADMIN_EMAILS = " Curator@Example.com ";
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "curator-id", email: "curator@example.com" } },
      error: null,
    });

    await expect(authorizeHumanCurator()).resolves.toEqual({
      kind: "authorized",
      actorId: "curator-id",
      origin: "human",
      rateLimitKey: "curator-id",
    });
  });
});
```

The production mutation caught by these tests is a missing or weakened allowlist branch that would authorize a generic authenticated user.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run src/lib/admin-auth.test.ts
```

Expected: FAIL because `authorizeHumanCurator` is not exported.

- [x] **Step 3: Implement the minimum shared function**

In `src/lib/admin-auth.ts`, define an exported type that excludes automation authorization and add this function:

```typescript
export type HumanCuratorAuthorization =
  | {
      readonly kind: "authorized";
      readonly actorId: string;
      readonly origin: "human";
      readonly rateLimitKey: string;
    }
  | Extract<CuratorAuthorization, { kind: "denied" }>;

export async function authorizeHumanCurator(): Promise<HumanCuratorAuthorization> {
  const allowedEmails = configuredAdminEmails();
  if (allowedEmails.length === 0) {
    return {
      kind: "denied",
      status: 503,
      message: "ADMIN_EMAILS is not configured.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      kind: "denied",
      status: 401,
      message: "관리자 로그인이 필요합니다.",
    };
  }

  if (!user.email || !allowedEmails.includes(user.email.toLowerCase())) {
    return {
      kind: "denied",
      status: 403,
      message: "카탈로그 편집 권한이 없습니다.",
    };
  }

  return {
    kind: "authorized",
    actorId: user.id,
    origin: "human",
    rateLimitKey: user.id,
  };
}
```

After the automation-secret branch in `authorizeCurator()`, replace its duplicated human-session body with:

```typescript
return authorizeHumanCurator();
```

- [x] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run src/lib/admin-auth.test.ts
```

Expected: all human-authorization tests pass.

- [x] **Step 5: Run affected API authorization tests**

Run:

```bash
pnpm exec vitest run 'src/app/api/foods/[id]/publish/route.test.ts' 'src/app/api/foods/[id]/sources/route.test.ts' 'src/app/api/foods/[id]/sources/apply/route.test.ts'
```

Expected: the existing automation and human API authorization contracts pass unchanged.

---

### Task 2: Gate Sensitive Server Pages Before Private Loads

**Files:**

- Create: `src/app/new/review/page.test.tsx`
- Modify: `src/app/new/review/page.tsx`
- Create: `src/app/new/transcribe/page.test.tsx`
- Modify: `src/app/new/transcribe/page.tsx`

**Interfaces:**

- Consumes: `authorizeHumanCurator()` from Task 1 and Next.js `redirect()` / `notFound()`.
- Produces: no new public interface. Each page authorizes before invoking its existing private loader.

- [x] **Step 1: Write the failing publication-review page tests**

Create `src/app/new/review/page.test.tsx` with hoisted doubles for the external authorization and service-role data boundaries.

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeHumanCurator: vi.fn(),
  loadPublicationReview: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/admin-auth", () => ({
  authorizeHumanCurator: mocks.authorizeHumanCurator,
}));
vi.mock("@/lib/publication-review", () => ({
  loadPublicationReview: mocks.loadPublicationReview,
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));

import ReviewPage from "./page";

describe("ReviewPage curator boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("미로그인 요청은 Draft를 읽기 전에 로그인으로 보낸다", async () => {
    mocks.authorizeHumanCurator.mockResolvedValue({
      kind: "denied",
      status: 401,
      message: "관리자 로그인이 필요합니다.",
    });

    await expect(ReviewPage()).rejects.toThrow(
      "NEXT_REDIRECT:/auth/login?next=%2Fnew%2Freview",
    );
    expect(mocks.loadPublicationReview).not.toHaveBeenCalled();
  });

  it("권한 없는 로그인 요청은 Draft를 읽기 전에 404로 숨긴다", async () => {
    mocks.authorizeHumanCurator.mockResolvedValue({
      kind: "denied",
      status: 403,
      message: "카탈로그 편집 권한이 없습니다.",
    });

    await expect(ReviewPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.loadPublicationReview).not.toHaveBeenCalled();
  });

  it("허용된 인간 관리자만 초기 Draft를 읽는다", async () => {
    mocks.authorizeHumanCurator.mockResolvedValue({
      kind: "authorized",
      actorId: "curator-id",
      origin: "human",
      rateLimitKey: "curator-id",
    });
    mocks.loadPublicationReview.mockResolvedValue({ brands: [], foods: [] });

    await expect(ReviewPage()).resolves.toBeTruthy();
    expect(mocks.loadPublicationReview).toHaveBeenCalledOnce();
  });
});
```

The production mutation caught by this test is moving or removing authorization so that `loadPublicationReview()` executes first.

- [x] **Step 2: Write the failing transcription-page tests**

Create `src/app/new/transcribe/page.test.tsx` with this complete test boundary:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeHumanCurator: vi.fn(),
  loadPendingTranscripts: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/admin-auth", () => ({
  authorizeHumanCurator: mocks.authorizeHumanCurator,
}));
vi.mock("@/lib/label-transcripts", () => ({
  loadPendingTranscripts: mocks.loadPendingTranscripts,
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));

import TranscribePage from "./page";

describe("TranscribePage curator boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("미로그인 요청은 전사안을 읽기 전에 로그인으로 보낸다", async () => {
    mocks.authorizeHumanCurator.mockResolvedValue({
      kind: "denied",
      status: 401,
      message: "관리자 로그인이 필요합니다.",
    });

    await expect(TranscribePage()).rejects.toThrow(
      "NEXT_REDIRECT:/auth/login?next=%2Fnew%2Ftranscribe",
    );
    expect(mocks.loadPendingTranscripts).not.toHaveBeenCalled();
  });

  it("권한 없는 로그인 요청은 전사안을 읽기 전에 404로 숨긴다", async () => {
    mocks.authorizeHumanCurator.mockResolvedValue({
      kind: "denied",
      status: 403,
      message: "카탈로그 편집 권한이 없습니다.",
    });

    await expect(TranscribePage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.loadPendingTranscripts).not.toHaveBeenCalled();
  });

  it("허용된 인간 관리자만 초기 전사안을 읽는다", async () => {
    mocks.authorizeHumanCurator.mockResolvedValue({
      kind: "authorized",
      actorId: "curator-id",
      origin: "human",
      rateLimitKey: "curator-id",
    });
    mocks.loadPendingTranscripts.mockResolvedValue([]);

    await expect(TranscribePage()).resolves.toBeTruthy();
    expect(mocks.loadPendingTranscripts).toHaveBeenCalledOnce();
  });
});
```

- [x] **Step 3: Run both page tests and verify RED**

Run:

```bash
pnpm exec vitest run src/app/new/review/page.test.tsx src/app/new/transcribe/page.test.tsx
```

Expected: denied cases FAIL because both private loaders currently execute without calling `authorizeHumanCurator()`.

- [x] **Step 4: Add the minimum page gates**

In each page, import `authorizeHumanCurator`, `notFound`, and `redirect` and execute the following before the private loader, using that page's literal route:

```typescript
const authorization = await authorizeHumanCurator();
if (authorization.kind === "denied") {
  if (authorization.status === 401) {
    redirect(`/auth/login?next=${encodeURIComponent("/new/review")}`);
  }
  notFound();
}
```

For the transcription page, use `"/new/transcribe"`.

Treat status 503 like 403 for the public response: do not disclose configuration details or private route data.

- [x] **Step 5: Run both page tests and verify GREEN**

Run:

```bash
pnpm exec vitest run src/app/new/review/page.test.tsx src/app/new/transcribe/page.test.tsx
```

Expected: all six page-boundary tests pass and denied requests never invoke private loaders.

---

### Task 3: Reject Over-100 Totals With Stated NFE

**Files:**

- Modify: `src/lib/domain.test.ts`
- Modify: `src/lib/domain.ts`

**Interfaces:**

- Consumes: `NutrientInput.carb_pct` only when explicitly present.
- Preserves: `validate(n: NutrientInput, d: Derived): Flag[]` and the inverse-derived NFE path in `computeDerived()`.

- [x] **Step 1: Write the failing stated-NFE regression**

Add this case to `describe("validate 보장성분 합계")` in `src/lib/domain.test.ts`:

```typescript
it("명시 NFE를 포함한 합계가 100%를 넘으면 차단한다", () => {
  const flags = sumErrors({
    protein_pct: 40,
    fat_pct: 30,
    fiber_pct: 10,
    ash_pct: 10,
    moisture_pct: 0,
    carb_pct: 20,
  });

  expect(flags).toHaveLength(1);
  expect(flags[0]).toMatchObject({ level: "error" });
  expect(flags[0].msg).toContain("110%");
});
```

The production mutation caught by this test is omitting an explicitly stated carbohydrate percentage from the guaranteed-analysis total.

- [x] **Step 2: Add the derived-NFE compatibility regression**

Add an over-100 guaranteed-analysis input without `carb_pct` and a corresponding negative derived NFE. This pins that a derived value cannot cancel an explicit-input total error:

```typescript
it("명시 NFE가 없으면 음수 파생 NFE로 합계 오류를 상쇄하지 않는다", () => {
  const flags = validate(
    {
      protein_pct: 40,
      fat_pct: 30,
      fiber_pct: 10,
      ash_pct: 15,
      moisture_pct: 10,
    },
    { ...NEUTRAL, carb_pct: -5 },
  ).filter((flag) => flag.msg.includes("합계"));

  expect(flags).toHaveLength(1);
  expect(flags[0].msg).toContain("105%");
});
```

This compatibility test must still report the 105% explicit-input total even though the derived NFE is -5%.

- [x] **Step 3: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run src/lib/domain.test.ts
```

Expected: the new 110% stated-NFE case FAILS with zero sum errors, while the derived-NFE compatibility case passes.

- [x] **Step 4: Include only explicit carbohydrate in the sum**

In `validate()`, extend the literal field list from:

```typescript
["protein_pct", "fat_pct", "fiber_pct", "ash_pct", "moisture_pct"];
```

to:

```typescript
["protein_pct", "fat_pct", "fiber_pct", "ash_pct", "moisture_pct", "carb_pct"];
```

Do not reference `d.carb_pct` in this sum.

- [x] **Step 5: Run domain and publication tests and verify GREEN**

Run:

```bash
pnpm exec vitest run src/lib/domain.test.ts src/lib/food-publication.test.ts src/lib/fixtures.test.ts
```

Expected: all focused domain, publication, and fixture tests pass.

---

### Task 4: Verify the First Remediation Stream

**Files:**

- Verify only; do not add implementation files unless a verification failure proves a scoped defect.

**Interfaces:**

- Consumes: Tasks 1 through 3.
- Produces: a verified first-stream checkpoint ready for review and a later concern-separated commit request.

- [x] **Step 1: Run the full automated suite**

Run:

```bash
pnpm test
```

Expected: all Vitest files and tests pass.

- [x] **Step 2: Run static verification**

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: both commands exit zero.

- [x] **Step 3: Run the production build**

Run:

```bash
pnpm build
```

Expected: the Next.js production build completes and both sensitive server pages compile.

- [x] **Step 4: Check the exact change boundary**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: changes are limited to the approved spec, this plan, the two authorization pages and tests, `admin-auth`, and the domain validator and test. No migration, generated type, dependency, lockfile, or unrelated file appears.

- [x] **Step 5: Record the semantic commit boundaries without committing**

Keep these later commit groups available for an explicit commit request:

```plaintext
docs(audit): define remediation program and first implementation plan
fix(auth): protect curator server-rendered draft pages
fix(domain): validate totals with stated carbohydrate
```
