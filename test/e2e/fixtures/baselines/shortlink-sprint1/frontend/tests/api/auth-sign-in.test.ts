import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../src/app/api/auth/sign-in/route";

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/sign-in (D-1 proxy)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("relays the backend's Set-Cookie header onto the browser response", async () => {
    const memberView = { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com" };
    const backendResponse = new Response(JSON.stringify(memberView), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "session_id=abc123; HttpOnly; Secure; SameSite=Lax",
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendResponse));

    const response = await POST(buildRequest({ email: "a@example.com", password: "secret" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(memberView);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("session_id=abc123");
    expect(setCookie).toContain("HttpOnly");
  });

  it("relays a 401 with no Set-Cookie header when the backend rejects credentials", async () => {
    const errorBody = { error: "invalid_credentials" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(errorBody), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const response = await POST(buildRequest({ email: "a@example.com", password: "wrong" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual(errorBody);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
