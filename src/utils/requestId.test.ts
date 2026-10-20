import { describe, expect, it } from "vitest";

import { newRequestId } from "./requestId";

describe("newRequestId", () => {
  it("returns 32 lowercase hex characters, unique per call", () => {
    const ids = new Set(Array.from({ length: 1000 }, newRequestId));

    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});
