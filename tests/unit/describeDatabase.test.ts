import { describe, expect, it } from "vitest";

import { describeDatabase } from "../../scripts/ops/restoreCheck";

describe("describeDatabase", () => {
  it.each([
    [
      "postgresql://user:pw@ep-x.neon.tech:5432/db?sslmode=require",
      "postgresql://ep-x.neon.tech:5432/db",
    ],
    [
      "postgresql://ep-x.neon.tech/db?user=u&password=hunter2",
      "postgresql://ep-x.neon.tech/db",
    ],
    ["postgresql://user:pw@h/db?sslpassword=keypass", "postgresql://h/db"],
    [
      "prisma+postgres://accelerate.prisma-data.net/?api_key=eyJabc",
      "prisma+postgres://accelerate.prisma-data.net/",
    ],
    ["postgresql://user:p@ss@h/db", "postgresql://h/db"],
  ])("keeps only scheme, host and database for %s", (url, expected) => {
    expect(describeDatabase(url)).toBe(expected);
  });

  it("never echoes a URL it cannot parse", () => {
    expect(describeDatabase("postgresql://user:pa/ss@h/db")).toBe(
      "(unparseable URL)",
    );
  });
});
