import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectToLogin(request, "missing_code");
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(safeNextUrl(request));
  } catch {
    return redirectToLogin(request, "exchange_failed");
  }

  return redirectToLogin(request, "exchange_failed");
}

function redirectToLogin(request: NextRequest, error: string) {
  const loginUrl = new URL("/auth/login", request.url);
  loginUrl.searchParams.set("error", error);
  return NextResponse.redirect(loginUrl);
}

function safeNextUrl(request: NextRequest): URL {
  const next = request.nextUrl.searchParams.get("next");
  if (next) {
    try {
      const candidate = new URL(next, request.url);
      if (
        candidate.origin === request.nextUrl.origin &&
        (candidate.pathname === "/new" || candidate.pathname === "/feeding")
      ) {
        return candidate;
      }
    } catch {
      return new URL("/feeding", request.url);
    }
  }
  return new URL("/feeding", request.url);
}
