import { describe, expect, it } from "vitest";
import { diffFields } from "./index";

describe("diffFields", () => {
  it("reports only changed fields", () => {
    expect(diffFields({ a: 1, b: "x" }, { a: 2, b: "x" })).toEqual([{ field: "a", before: 1, after: 2 }]);
  });

  it("handles added and removed fields", () => {
    const d = diffFields({ a: 1 }, { b: 2 });
    expect(d).toEqual([
      { field: "a", before: 1, after: undefined },
      { field: "b", before: undefined, after: 2 },
    ]);
  });

  it("treats null input as empty", () => {
    expect(diffFields(null, { enabled: true })).toEqual([{ field: "enabled", before: undefined, after: true }]);
  });
});
