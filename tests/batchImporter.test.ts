import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert";
import BatchImporter from "../src/modules/batchImporter";

describe("BatchImporter Suite", () => {
  describe("generateBatchId", () => {
    test("should generate batch ID with timestamp format refnexus_batch_YYYYMMDD_HHMMSS", () => {
      const id = BatchImporter.generateBatchId();
      assert.match(id, /^ref(?:nexus)?_batch_\d{8}_\d{6}$/);
    });

    test("should generate non-empty unique string", () => {
      const id1 = BatchImporter.generateBatchId();
      assert.ok(id1.length > 15);
    });
  });

  describe("rollbackBatch safety check", () => {
    test("must exclude parentItem.id from deletion target IDs", async () => {
      let trashedIds: number[] = [];

      // Mock parentItem with ID 999
      const parentItem: any = {
        id: 999,
        libraryID: 1,
        getField: (f: string) => (f === "extra" ? "ref_batch_parent: ref_batch_20260929_120000" : ""),
        setField: (f: string, v: string) => {},
        saveTx: async () => true,
        removeRelatedItem: async () => true
      };

      // Mock Zotero.Items.trashTx to spy on which IDs are passed
      const originalTrashTx = (globalThis as any).Zotero.Items.trashTx;
      (globalThis as any).Zotero.Items.trashTx = async (ids: number[]) => {
        trashedIds = ids;
        return true;
      };

      try {
        const deletedCount = await BatchImporter.rollbackBatch(parentItem, "ref_batch_20260929_120000");

        // The mock search returned [101, 102, 999]
        // Verify that 999 (parentItem.id) is strictly filtered out!
        assert.ok(!trashedIds.includes(999), "CRITICAL: parentItem.id was not filtered out of rollback trash!");
        assert.deepStrictEqual(trashedIds, [101, 102]);
        assert.strictEqual(deletedCount, 2);
      } finally {
        (globalThis as any).Zotero.Items.trashTx = originalTrashTx;
      }
    });

    test("should clean up scoped batch metadata from parentItem extra field", async () => {
      let savedExtra = "";
      const batchId = "refnexus_batch_20260929_150000";
      const parentItem: any = {
        id: 999,
        libraryID: 1,
        getField: (f: string) => `refnexus_batch_parent: ${batchId}\nimport_collection_${batchId}: 42\nimport_related_existing_${batchId}: 101,102`,
        setField: (f: string, v: string) => { savedExtra = v; },
        saveTx: async () => true,
        removeRelatedItem: async () => true
      };

      await BatchImporter.rollbackBatch(parentItem, batchId);
      assert.strictEqual(savedExtra.includes(batchId), false);
      assert.strictEqual(savedExtra.includes("import_collection"), false);
      assert.strictEqual(savedExtra.includes("import_related_existing"), false);
    });
  });
});
