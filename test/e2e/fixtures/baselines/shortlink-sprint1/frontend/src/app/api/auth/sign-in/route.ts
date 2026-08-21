import { NextRequest, NextResponse } from "next/server";

/**
 * Same-origin proxy for `POST /auth/sign-in` (D-1). Must relay the backend's
 * `Set-Cookie` header onward to the browser with its attributes
 * (HttpOnly/Secure/SameSite=Lax) intact — `fetch` does not do this
 * automatically, so the header is read and re-set explicitly.
 */

const BACKEND_URL = process.env.BACKEND_URL ?? "http://backend:8000";

type HeadersWithGetSetCookie = Headers & { getSetCookie?: () => string[] };

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as unknown;

  const backendResponse = await fetch(`${BACKEND_URL}/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const responseBody = (await backendResponse.json()) as unknown;
  const nextResponse = NextResponse.json(responseBody, { status: backendResponse.status });

  relaySetCookie(backendResponse.headers, nextResponse);

  return nextResponse;
}

function relaySetCookie(backendHeaders: Headers, nextResponse: NextResponse): void {
  const headersWithGetSetCookie = backendHeaders as HeadersWithGetSetCookie;
  const setCookieHeaders = headersWithGetSetCookie.getSetCookie?.() ?? [];

  if (setCookieHeaders.length > 0) {
    for (const cookieHeader of setCookieHeaders) {
      nextResponse.headers.append("set-cookie", cookieHeader);
    }
    return;
  }

  const singleSetCookie = backendHeaders.get("set-cookie");
  if (singleSetCookie !== null) {
    nextResponse.headers.append("set-cookie", singleSetCookie);
  }
}
