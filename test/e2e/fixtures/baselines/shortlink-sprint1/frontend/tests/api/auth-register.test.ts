import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../src/app/api/auth/register/route";

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register (D-1 proxy)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards the request body to the backend and relays a 201 response verbatim", async () => {
    const memberView = { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(memberView), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(buildRequest({ email: "a@example.com", password: "secret" }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(memberView);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/register"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("relays a 409 error response from the backend unchanged", async () => {
    const errorBody = { error: "email_already_registered" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(errorBody), {
          status: 409,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const response = await POST(buildRequest({ email: "a@example.com", password: "secret" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(errorBody);
  });
});
