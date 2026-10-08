import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert";
import RetractionChecker from "../src/modules/retraction";

describe("RetractionChecker Suite", () => {
  const checker = new RetractionChecker();

  test("uses Zotero 10's native Retractions API for an actual library item", () => {
    const original=(Zotero as any).Retractions;
    (Zotero as any).Retractions={isRetracted:(item:any)=>item.id===123};
    const result = checker.checkLocal("10.1016/j.cell.retracted",{id:123} as any);
    assert.strictEqual(result.isRetracted, true);
    assert.strictEqual(result.checked,true);
    (Zotero as any).Retractions=original;
  });

  test("returns unchecked rather than pretending a DOI-only local lookup is authoritative", () => {
    const result = checker.checkLocal("10.1038/s41586-020-2649-2");
    assert.strictEqual(result.isRetracted, false);
    assert.strictEqual(result.checked,false);
  });

  test("should handle empty or undefined DOI defensively", () => {
    assert.strictEqual(checker.checkLocal(undefined).isRetracted, false);
    assert.strictEqual(checker.checkLocal("").isRetracted, false);
  });

  test("does not misclassify a retraction notice as a retracted article", async () => {
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
    assert.strictEqual(result.isRetracted, false);
    assert.strictEqual(result.checked,true);
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

  test("recognizes updated-by Retraction Watch records without confusing corrections with retractions", async () => {
    const request:any={get:async()=>({message:{"updated-by":[{type:"correction",DOI:"10.1000/correction"},{type:"retraction",source:"retraction-watch",DOI:"10.1000/notice"}]}})};
    assert.equal((await new RetractionChecker(request).checkDOI("10.1000/original",true)).isRetracted,true);
    request.get=async()=>({message:{"updated-by":[{type:"expression_of_concern"},{type:"correction"}]}});
    assert.equal((await new RetractionChecker(request).checkDOI("10.1000/original",true)).isRetracted,false);
  });
});
