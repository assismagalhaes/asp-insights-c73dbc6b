import { describe, expect, it } from "vitest";
import { withSecurityHeaders } from "./security-headers";

describe("withSecurityHeaders", () => {
  it("preserves the response and adds the production security policy", async () => {
    const original = new Response("ok", {
      status: 201,
      headers: { "content-type": "text/plain", "x-existing": "preserved" },
    });

    const secured = withSecurityHeaders(original);

    expect(secured.status).toBe(201);
    expect(secured.headers.get("content-type")).toBe("text/plain");
    expect(secured.headers.get("x-existing")).toBe("preserved");
    expect(secured.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(secured.headers.get("x-content-type-options")).toBe("nosniff");
    expect(secured.headers.get("x-frame-options")).toBe("DENY");
    expect(secured.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(secured.headers.get("permissions-policy")).toContain("camera=()");
    expect(secured.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await secured.text()).toBe("ok");
  });
});
