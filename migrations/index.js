// Migration registry and dispatch entry point. Currently a single hop
// (2.0 -> 3.0); add a row to MIGRATIONS to register the next one.

import { migrate_v2_0_to_v3_0, MigrationStepError } from "./v2-0_to_v3-0/index.js";

const MIGRATIONS = {
  "2.0": { to: "3.0", migrate: migrate_v2_0_to_v3_0 }
};

export class MigrationError extends Error {
  constructor({ code, message, ...rest }) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    Object.assign(this, rest);
  }
}

// migrateToVersion(engagement, targetVersion?, ctx?)
// Pipes through registered migrators until target version is reached.
// Multi-hop chains are handled naturally (e.g. 2.0 -> 3.0 -> 3.1).
export function migrateToVersion(engagement, targetVersion, ctx) {
  const target = targetVersion || "3.0";
  let current = engagement;
  let currentVersion =
    current?.engagementMeta?.schemaVersion ??
    current?.sessionMeta?.version ??
    "2.0";

  while (currentVersion !== target) {
    const m = MIGRATIONS[currentVersion];
    if (!m) {
      throw new MigrationError({
        code: "NO_MIGRATION_PATH",
        message: "No migration path from " + currentVersion + " to " + target,
        currentVersion,
        targetVersion: target
      });
    }
    current = m.migrate(current, ctx);
    currentVersion = m.to;
  }
  return current;
}

export { MigrationStepError };
