// core/version.js — APP_VERSION single source of truth
//
// The runtime-visible version string. The topbar chip and every UI surface
// that displays the version must import APP_VERSION from this file; version
// strings are never hard-coded anywhere else.
//
// Lifecycle of the value:
//   <X>.<Y>.<Z>            release tag
//   <X>.<Y>.<Z>-rc.<N>     release-candidate tag
//   <X>.<Y>.<Z>-rc.<N>-dev between rc.<N> and the next tag
//   <X>.<Y>.<Z>-dev        pre-first-rc dev
//
// The first commit past any tag adds the `-dev` suffix; tagging drops it in
// the same change that creates the tag.
//
// Distinct from:
//   - engagement schemaVersion — the schema-version tag carried on each
//     saved engagement. It has nothing to do with which build of the app
//     is running.
//   - git tags — runtime code doesn't read git; this string is the
//     runtime-visible version.

export const APP_VERSION = "3.1.0-dev";
