import { NextRequest, NextResponse } from "next/server";

/**
 * Same-origin proxy for `POST /auth/register` (D-1): the browser only ever
 * talks to this Next.js origin; this handler makes the server-side call to
 * FastAPI and relays its status and body unchanged.
 */

const BACKEND_URL = process.env.BACKEND_URL ?? "http://backend:8000";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as unknown;

  const backendResponse = await fetch(`${BACKEND_URL}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const responseBody = (await backendResponse.json()) as unknown;
  return NextResponse.json(responseBody, { status: backendResponse.status });
}
