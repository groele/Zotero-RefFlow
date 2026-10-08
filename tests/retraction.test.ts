import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert";
import RetractionChecker from "../src/modules/retraction";

describe("RetractionChecker Suite", () => {
  const checker = new RetractionChecker();

  test("should detect retracted paper from local RetractionWatch database", () => {
    const result = checker.checkLocal("10.1016/j.cell.retracted");
    assert.strictEqual(result.isRetracted, true);
    assert.strictEqual(result.reason, "Data falsification");
  });

  test("should return isRetracted: false for normal papers", () => {
    const result = checker.checkLocal("10.1038/s41586-020-2649-2");
    assert.strictEqual(result.isRetracted, false);
  });

  test("should handle empty or undefined DOI defensively", () => {
    assert.strictEqual(checker.checkLocal(undefined).isRetracted, false);
    assert.strictEqual(checker.checkLocal("").isRetracted, false);
  });

  test("should detect retraction from Crossref update-to record via checkDOI", async () => {
    const mockRequests = {
      get: async (url: string) => ({
        message: {
          "update-to": [
            { type: "retraction", updated: { "date-time": "2024-05-10T12:00:00Z" } }
          ]
        }
      })
    } as any;
    const remoteChecker = new RetractionChecker(mockRequests);
    const result = await remoteChecker.checkDOI("10.1000/remote.retracted", true);
    assert.strictEqual(result.isRetracted, true);
    assert.ok(result.reason?.includes("Crossmark 撤稿记录: retraction"));
    assert.strictEqual(result.updatedDate, "2024-05-10");
  });

  test("should detect retraction from Crossref is-retracted-by relation via checkDOI", async () => {
    const mockRequests = {
      get: async (url: string) => ({
        message: {
          relation: {
            "is-retracted-by": [
              { id: "10.1000/notice.123" }
            ]
          }
        }
      })
    } as any;
    const remoteChecker = new RetractionChecker(mockRequests);
    const result = await remoteChecker.checkDOI("10.1000/has.relation", true);
    assert.strictEqual(result.isRetracted, true);
    assert.ok(result.reason?.includes("10.1000/notice.123"));
  });
});
