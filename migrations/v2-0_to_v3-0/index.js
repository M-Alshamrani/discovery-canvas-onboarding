// Composition root for the v2.0 -> v3.0 migrator. Pipes the 10 steps in
// order. Each step is pure; the structuredClone at entry guarantees the
// input is never mutated even if a step accidentally tries.
//
// A thrown step bubbles up as a MigrationStepError carrying the step
// name and the partial engagement at the point of failure.

import {
  step01_schemaVersion,
  step02_engagementId,
  step03_ownerId,
  step04_timestamps,
  step05_customerLegacyFields,
  step06_extractDrivers,
  step07_collections,
  step08_dropProjectId,
  step09_wrapAILegacyFields,
  step10_stampEngagementId
} from "./steps.js";

const PIPELINE = [
  ["step01_schemaVersion",          step01_schemaVersion],
  ["step02_engagementId",           step02_engagementId],
  ["step03_ownerId",                step03_ownerId],
  ["step04_timestamps",             step04_timestamps],
  ["step05_customerLegacyFields",   step05_customerLegacyFields],
  ["step06_extractDrivers",         step06_extractDrivers],
  ["step07_collections",            step07_collections],
  ["step08_dropProjectId",          step08_dropProjectId],
  ["step09_wrapAILegacyFields",     step09_wrapAILegacyFields],
  ["step10_stampEngagementId",      step10_stampEngagementId]
];

export class MigrationStepError extends Error {
  constructor({ step, cause, partial }) {
    super('Migration step "' + step + '" failed: ' + (cause?.message || cause));
    this.name    = "MigrationStepError";
    this.code    = "MIGRATION_STEP_FAILED";
    this.step    = step;
    this.cause   = cause;
    this.partial = partial;
  }
}

export function migrate_v2_0_to_v3_0(oldEngagement, ctx) {
  // structuredClone available in modern browsers + Node >= 17.
  // Falls back to JSON-based deep clone for older runtimes.
  let current;
  try {
    current = (typeof structuredClone === "function")
      ? structuredClone(oldEngagement)
      : JSON.parse(JSON.stringify(oldEngagement));
  } catch (e) {
    throw new MigrationStepError({ step: "structuredClone", cause: e, partial: null });
  }

  for (const [name, step] of PIPELINE) {
    try {
      current = step(current, ctx);
    } catch (e) {
      throw new MigrationStepError({ step: name, cause: e, partial: current });
    }
  }
  return current;
}
