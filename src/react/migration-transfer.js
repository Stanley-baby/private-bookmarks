import { applyMigrationPackage, previewMigrationPackage } from "../../extension/shared/local-db.js";

export function createMigrationTransfer({ preview = previewMigrationPackage, apply = applyMigrationPackage } = {}) {
  let value = "";
  return {
    async select(file) {
      const next = await file.text();
      const result = await preview(next, { includeCurrent: true });
      value = next;
      return result;
    },
    apply(mode) {
      return value ? apply(value, mode) : Promise.resolve(null);
    },
  };
}
