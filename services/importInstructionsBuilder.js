// services/importInstructionsBuilder.js
//
// Builds the context-aware LLM Instructions Prompt .txt file the
// engineer downloads from the "Import data" modal (step 1 of two). The
// engineer takes the file to a separate Dell internal LLM (sensitive
// data cannot be sent through the Claude API), feeds it their source
// data, and receives a JSON response in the canonical import shape.
// Step 2 of the modal uploads that JSON; the shared importer and
// preview modal handle the rest.
//
// Output contract:
//   - The filename ends in .txt (universal; no markdown viewer assumed),
//     even though the content uses markdown conventions for readability.
//   - Filename convention:
//       dell-canvas-llm-instructions-prompt-<customer-slug>-<YYYYMMDD>-<HHmmss>.txt
//   - Throws NO_ENVIRONMENTS if the engagement has zero environments
//     (entry-point precondition).
//
// The instructions content is a full LLM prompt: explicit role, goal,
// and success criteria; worked examples across the workload /
// virtualization / compute / storage / dataProtection / infrastructure
// layers; counter-examples; a verification checklist the LLM runs on
// its own output before emitting; and chain-of-thought reasoning markers.

import { ENV_CATALOG } from "../core/config.js";

// Slugify a customer name for the filename · lowercase + non-alphanumeric
// to hyphens + collapse runs + trim. Empty / falsy customer name yields
// "untitled" so the filename is always well-formed.
function slugify(s) {
  if (!s || typeof s !== "string") return "untitled";
  return s.toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          || "untitled";
}

// UTC timestamp formatted YYYYMMDD-HHmmss for filename collision-resistance.
function utcStamp(d) {
  d = d || new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getUTCFullYear();
  const mo = pad(d.getUTCMonth() + 1);
  const da = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return y + mo + da + "-" + hh + mm + ss;
}

// Resolve an environment's display label from its envCatalogId. Falls
// back to the raw catalog id if no catalog entry is found.
function envLabelFor(envCatalogId) {
  const entry = ENV_CATALOG.find((c) => c.id === envCatalogId);
  return entry ? entry.label : envCatalogId;
}

// Build a markdown-style env-slot table for the instructions body.
// PRECONDITION: engagement has at least 1 environment (enforced upstream).
function buildEnvSlotTable(engagement) {
  const allIds = engagement.environments.allIds;
  const byId   = engagement.environments.byId;
  const lines = [];
  lines.push("| UUID | Label | Catalog ID |");
  lines.push("|---|---|---|");
  allIds.forEach((uuid) => {
    const env = byId[uuid] || {};
    const label = env.alias || envLabelFor(env.envCatalogId);
    lines.push("| `" + uuid + "` | " + label + " | " + (env.envCatalogId || "?") + " |");
  });
  return lines.join("\n");
}

// Pick the first env UUID + label for substitution into worked examples.
// Pure helper · safe on a >= 1 env engagement (precondition checked upstream).
function firstEnvFor(engagement) {
  const uuid = engagement.environments.allIds[0];
  const env  = engagement.environments.byId[uuid] || {};
  return { uuid: uuid, label: env.alias || envLabelFor(env.envCatalogId) };
}

// buildImportInstructions(engagement, opts) -> { filename, content }
//   engagement       - the live engagement object (customer + environments)
//   opts.scope       - "current" | "desired" | "both" (default "current")
//   opts.now         - Date override for tests (defaults to new Date())
//
// Precondition: engagement.environments.allIds.length must be >= 1.
export function buildImportInstructions(engagement, opts) {
  const allIds = (engagement && engagement.environments && Array.isArray(engagement.environments.allIds))
    ? engagement.environments.allIds : [];
  if (allIds.length === 0) {
    const err = new Error(
      "buildImportInstructions called on an engagement with 0 environments. " +
      "Add at least one environment in the Context tab before generating instructions. " +
      "(The Dell internal LLM has nothing to map extracted rows to without environment UUIDs in the engagement.)"
    );
    err.code = "NO_ENVIRONMENTS";
    throw err;
  }

  const scope = (opts && opts.scope) || "current";
  const now   = (opts && opts.now)   || new Date();

  const customer = (engagement && engagement.customer) || {};
  const customerName = customer.name || "Untitled Customer";
  const customerVertical = customer.vertical || "(unspecified vertical)";
  const customerRegion = customer.region || "(unspecified region)";

  const engCreatedAt = (engagement && engagement.meta && engagement.meta.createdAt)
    || (engagement && engagement.meta && engagement.meta.engagementDate)
    || "(unspecified date)";

  // Filename prefix.
  const filename = "dell-canvas-llm-instructions-prompt-"
                 + slugify(customerName) + "-" + utcStamp(now) + ".txt";

  const envTable = buildEnvSlotTable(engagement);
  const exampleEnv = firstEnvFor(engagement);

  const sections = [];

  // ─── HEADER ─────────────────────────────────────────────────────────
  sections.push(
    "# LLM Instructions Prompt · Dell Discovery Canvas data extraction",
    "",
    "*Generated: " + now.toISOString() + " · Customer: " + customerName + " · Apply scope: " + scope + "*",
    ""
  );

  // ─── 1 · YOUR ROLE + GOAL + SUCCESS CRITERIA ───────────────────────
  sections.push(
    "## 1. Your role · your task · success criteria",
    "",
    "**Your role**: you are an extraction specialist assisting a Dell Technologies presales engineer running a Discovery Canvas workshop with **" + customerName + "** (" + customerVertical + " / " + customerRegion + "). The engineer has attached a customer-provided source file (Excel install-base, CSV inventory, PDF estate diagram, or TXT memo) that describes the customer's technology landscape.",
    "",
    "**Your task**: read the source file and emit ONE structured JSON record per discrete technology instance you can identify · output ONLY a single JSON object matching the schema in §6 · no prose around it · no markdown fences · no commentary.",
    "",
    "**Definition of done · success criteria**:",
    "1. Every items[] entry references an `environmentId` that is one of the UUIDs in §2 (verbatim · no UUID inventions).",
    "2. Every items[] entry has a confidence rating (high / medium / low) backed by a one-sentence rationale citing the source row or location.",
    "3. Every items[] entry has all 8 required `data` fields: state, layerId, environmentId, label, vendor, vendorGroup, criticality, notes.",
    "4. The complete JSON validates against the schema in §6 (parses without error · all enum values exact-match).",
    "5. You ran the verification checklist in §10 BEFORE emitting your response.",
    "6. You followed the Phase A · B · C walkthrough below — you did NOT skip Phase B confirmation with the engineer.",
    ""
  );

  // ─── PHASE A SCAFFOLD ───────────────────────────────────────────────
  // The Phase A heading tells the LLM to use the next four sections as
  // silent inputs, with no engineer-visible output yet.
  sections.push(
    "### Phase A · Extract",
    "",
    "**Read sections 2-5 below to learn the schema, the environment UUIDs, the glossary, and the chain-of-thought reasoning pattern. Apply them to the source file the engineer uploaded into this chat. Build your candidate items[] list internally.**",
    "",
    "**Do NOT show the engineer anything yet. Do NOT emit JSON. Do NOT enumerate the rows in chat.**",
    "",
    "When you have processed every row in the source file and built the candidate list, move to Phase B.",
    ""
  );

  // ─── 2 · ENVIRONMENT SLOTS (CRITICAL FK TARGETS) ────────────────────
  sections.push(
    "## 2. Environment slots (CRITICAL · MUST be one of these UUIDs verbatim)",
    "",
    "Every `items[].data.environmentId` in your output MUST be one of the UUIDs in the table below — verbatim, no transformation. **Do NOT invent UUIDs. Do NOT remap UUIDs to friendly names. Do NOT use the envCatalogId in place of the UUID.** The Discovery Canvas validates strict-match on import and rejects responses that reference any UUID not in this list.",
    "",
    envTable,
    "",
    "If the source file describes a technology that doesn't clearly belong to any environment above, emit it with confidence:\"low\" and pick the closest match · explain the ambiguity in the `rationale` field.",
    ""
  );

  // ─── 3 · DATA SCHEMA ────────────────────────────────────────────────
  sections.push(
    "## 3. Data schema (per items[].data)",
    "",
    "Each `items[].data` object MUST conform to this exact shape:",
    "",
    "- `state` · enum: `\"current\"` | `\"desired\"` | `null`",
    "  - `\"current\"` if the source signals existing / in-production / today's-estate (see §8 state-hint guidance).",
    "  - `\"desired\"` if the source signals planned / proposed / target-architecture / future-state.",
    "  - `null` if the source is silent · the engineer chooses scope at apply time.",
    "- `layerId` · enum: one of `workload` | `virtualization` | `compute` | `storage` | `dataProtection` | `infrastructure`. FK to LAYERS catalog.",
    "- `environmentId` · one of the UUIDs in §2. Verbatim. No inventions.",
    "- `label` · human-readable name, ≤ 60 characters. Example: `\"Oracle Production DB\"` or `\"PowerStore 5200 (DR)\"`.",
    "- `vendor` · vendor name as it appears in source. Example: `\"Oracle\"`, `\"Dell\"`, `\"Cisco\"`, `\"VMware\"`.",
    "- `vendorGroup` · enum: `\"dell\"` (any Dell-branded product) | `\"nonDell\"` (named non-Dell vendor) | `\"custom\"` (in-house / unknown / generic).",
    "- `criticality` · enum: `\"High\"` | `\"Medium\"` | `\"Low\"`. Business criticality, NOT technical risk.",
    "- `notes` · ≤ 200 characters. Source context (license, EOL date, version, role). Empty string `\"\"` if none.",
    ""
  );

  // ─── 4 · SEMANTIC GLOSSARY ──────────────────────────────────────────
  sections.push(
    "## 4. Semantic glossary",
    "",
    "- **Layer** is the technology plane the instance lives in. There are SIX layers, business-facing to physical:",
    "  - `workload` · the application that delivers actual business value — what the company runs the rest of the stack for. Map it to the business it serves: a hospital's EHR/clinical system is `workload` (vertical = healthcare), a bank's core banking platform is `workload` (vertical = banking). Includes vendor-packaged apps (SAP, Salesforce, M365) and custom/in-house apps.",
    "  - `virtualization` · SOFTWARE that defines/abstracts compute or storage resources: hypervisors (VMware vSphere/vCenter, Hyper-V, KVM, Nutanix AHV), container/orchestration platforms (Kubernetes, OpenShift), AND software-defined storage (vSAN, Storage Spaces Direct, Ceph). If it is a software layer that virtualizes hardware — even storage hardware — it is `virtualization`, not `storage` or `compute`.",
    "  - `compute` · HARDWARE that performs computation, hypervisor or not: physical servers, blade/modular systems, workstations, laptops. A server stays `compute` even when it runs a hypervisor — the box is `compute`, the hypervisor software on it is a separate `virtualization` instance if the engineer wants it tracked.",
    "  - `storage` · general-purpose storage SERVICES/arrays (SAN/NAS, object storage, file storage) that are not purpose-built for data protection.",
    "  - `dataProtection` · anything purpose-built to keep data safe: backup, replication, ransomware/cyber recovery, DR targets (PowerProtect, Veeam, Cohesity, Rubrik, Zerto, cloud backup services). Technically storage-shaped, but always classified separately from `storage` because it's purpose-built and commercially significant.",
    "  - `infrastructure` · everything needed to run the infra itself that isn't workload/compute/storage: networking (switches, routers, SD-WAN), load balancers, DNS, SMTP/mail relay, firewalls, identity, monitoring, automation/management tooling. This layer merges networking + security + general infra services into one bucket.",
    "- **Environment** is the SITE / location the instance physically resides in. Always a UUID; resolve via §2.",
    "- **Current** instances exist today in the customer's estate. **Desired** instances are proposed / planned / future-state.",
    "- **Criticality** measures business importance (mission-critical / important / routine), NOT technical risk or complexity.",
    ""
  );

  // ─── 5 · CHAIN-OF-THOUGHT REASONING PATTERN ────────────────────────
  sections.push(
    "## 5. How to reason about each row (think step by step)",
    "",
    "For each row / item / line in the source file, reason in this order before writing the JSON entry:",
    "",
    "**Step 1**: Identify the technology. What is it? Vendor name? Product? Version?",
    "**Step 2**: Classify the layer. Is this workload, virtualization, compute, storage, dataProtection, or infrastructure? Use §4 glossary — watch the two splits that most often get miscalled: software (virtualization) vs hardware (compute), and general storage (storage) vs purpose-built backup/replication/recovery (dataProtection).",
    "**Step 3**: Determine the environment. Where is it deployed? Match to a UUID in §2.",
    "**Step 4**: Assign state hint. Is the source describing existing infrastructure (current) or proposed (desired)? Use §8 state-hint guidance. If silent, set `null`.",
    "**Step 5**: Assign confidence. How certain are you about steps 1-4? Use §7 confidence guidance.",
    "**Step 6**: Write the JSON entry. Fill all 8 data fields. Cite the source row in `rationale`.",
    "**Step 7**: Self-check against §10 verification checklist before adding to items[].",
    ""
  );

  // ─── PHASE B BODY ───────────────────────────────────────────────────
  // The Phase B section is the engineer-confirmation loop: the
  // stop-and-confirm marker, the mapping-table fallback chain, the
  // naming-confirmation prompt, and the approval-signal vocabulary.
  sections.push(
    "### Phase B · Confirm with engineer",
    "",
    "**STOP and confirm** before emitting any final JSON. Present your candidate items[] list to the engineer as a **mapping table** so the engineer can review, correct, and approve.",
    "",
    "**Mapping table format · graceful degradation chain** (pick the highest one your runtime supports):",
    "",
    "1. **Markdown table** (preferred) — render a table with columns: source label · proposed canvas label · layerId · environmentId (short UUID prefix is fine in the display, but use the full UUID in the final JSON) · vendor · vendorGroup · criticality · state hint · confidence.",
    "2. **CSV attachment** — if you cannot render markdown tables well, generate a downloadable CSV file with the same columns. Tell the engineer they can open it in Excel, make corrections inline, and paste the corrected rows back to you.",
    "3. **Fixed-width plaintext table** — last-resort universal fallback. Align columns with spaces. Use a single header row + one dashed separator row.",
    "",
    "After rendering the table, ask the engineer two explicit questions:",
    "",
    "**Question 1 · Naming confirmation**: \"Should I keep the source labels **verbatim** (exactly as written in the source file), or should I **normalize** them (e.g., `EXCH-PROD-01` → `Exchange Production 01`, expand abbreviations, fix casing)?\" Wait for the engineer's choice before proceeding.",
    "",
    "**Question 2 · Mapping approval**: \"Does this mapping look correct? Reply with `looks good`, `approved`, `ship it`, `go ahead`, or `yes` if everything is right. Otherwise, point out the rows that need correction and I'll iterate.\"",
    "",
    "**Approval signals** (any of these mean go to Phase C):",
    "- `looks good`",
    "- `approved`",
    "- `ship it`",
    "- `go ahead`",
    "- `yes`",
    "",
    "**Anything else means \"needs correction\"** — iterate on the table. Common corrections the engineer may request:",
    "- Rewrite specific labels (apply or revoke normalization on a per-row basis)",
    "- Reassign rows to a different environment UUID",
    "- Promote/demote confidence ratings",
    "- Flip a row's state hint between current / desired / null",
    "- Drop rows that are not actually in scope",
    "",
    "After each correction, re-render the table and re-ask Question 2. Loop until you receive an approval signal. **Do NOT skip ahead to Phase C until the engineer explicitly approves.**",
    ""
  );

  // ─── PHASE C SCAFFOLD ───────────────────────────────────────────────
  // The Phase C heading marks the final-emit boundary; the following
  // sections are the emit-time references (JSON shape, confidence,
  // state-hint, examples, verification checklist).
  sections.push(
    "### Phase C · Emit final JSON",
    "",
    "**Only after the engineer has approved in Phase B**, emit the final JSON object using §6 (JSON shape) + §7 (confidence) + §8 (state-hint) + §9 (worked examples) as references. Run §10 verification checklist on your output BEFORE emitting.",
    "",
    "Output ONLY the JSON object · no prose, no markdown fences, no commentary. Then tell the engineer: \"Save this as a `.json` file and import it back into Canvas via the **Import data** modal Step 2.\"",
    ""
  );

  // ─── 6 · REQUIRED OUTPUT JSON SHAPE ─────────────────────────────────
  sections.push(
    "## 6. Required output JSON shape",
    "",
    "Output ONLY this JSON object · no prose, no markdown fences, no commentary:",
    "",
    "```json",
    "{",
    "  \"schemaVersion\": \"1.0\",",
    "  \"kind\": \"instance.add\",",
    "  \"generatedAt\": \"<ISO instant when you generated this response>\",",
    "  \"items\": [",
    "    {",
    "      \"confidence\": \"high\",",
    "      \"rationale\": \"Source citation, e.g. 'Excel sheet Compute, row 14'\",",
    "      \"data\": {",
    "        \"state\": \"current\",",
    "        \"layerId\": \"compute\",",
    "        \"environmentId\": \"<one of the UUIDs in §2>\",",
    "        \"label\": \"<≤60 chars>\",",
    "        \"vendor\": \"<vendor name>\",",
    "        \"vendorGroup\": \"dell\",",
    "        \"criticality\": \"High\",",
    "        \"notes\": \"<≤200 chars or empty string>\"",
    "      }",
    "    }",
    "  ]",
    "}",
    "```",
    ""
  );

  // ─── 7 · CONFIDENCE GUIDANCE ────────────────────────────────────────
  sections.push(
    "## 7. Confidence rating · how to choose high / medium / low",
    "",
    "- **high** · the source row is explicit and unambiguous · named vendor + named product + clear environment hint. Example: \"Dell PowerStore 5200, deployed at Primary DC, production cluster\".",
    "- **medium** · partial information · vendor known but model/version inferred · environment inferred from team/region tag. Example: \"Oracle DB on the central infra team's stack\".",
    "- **low** · multiple plausible interpretations · missing fields filled with defaults · ambiguous environment / layer / criticality. Use sparingly and explain the ambiguity in `rationale`.",
    ""
  );

  // ─── 8 · STATE-HINT GUIDANCE ────────────────────────────────────────
  sections.push(
    "## 8. State-hint guidance (when to mark current / desired / null)",
    "",
    "**Mark `state: \"current\"`** when the source uses signals like: \"currently running\", \"in production\", \"existing\", \"today's environment\", \"EOL Q4\", \"legacy\", \"installed base\", a deployment date in the past, an inventory snapshot.",
    "",
    "**Mark `state: \"desired\"`** when the source uses signals like: \"planned\", \"proposed\", \"future\", \"TBD\", \"Q3 2027 migration\", \"target architecture\", \"to be procured\", \"recommendation\".",
    "",
    "**Mark `state: null`** when the source is silent · the engineer's modal scope picker is AUTHORITATIVE and overrides per-row hints at apply time. Setting null is honest about ambiguity; making up a state is dishonest about ambiguity.",
    ""
  );

  // ─── 9 · WORKED EXAMPLES (across layers) + COUNTER-EXAMPLES ─────────
  sections.push(
    "## 9. Worked examples (6 positives across all layers + counter-examples)",
    "",
    "Synthetic data only · never reference a real customer.",
    "",
    "### Example A · COMPUTE · high confidence",
    "**Source row** (Excel install-base, row 14): \"Dell PowerEdge R760, Site A, prod cluster, 32-node, Mission-Critical\"",
    "**Reasoning**: vendor Dell + product PowerEdge R760 (explicit) → layer compute (it's the physical box) · environment Site A → " + exampleEnv.label + " · state \"current\" (existing prod) · criticality High (mission-critical signal). If the source separately mentioned the hypervisor running on these hosts, that would be its own `virtualization` item (see Example C) — the hardware and the software on it are tracked as two layers.",
    "**JSON**:",
    "```json",
    "{ \"confidence\": \"high\", \"rationale\": \"Excel install-base row 14\", \"data\": { \"state\": \"current\", \"layerId\": \"compute\", \"environmentId\": \"" + exampleEnv.uuid + "\", \"label\": \"PowerEdge R760 (32-node prod cluster)\", \"vendor\": \"Dell\", \"vendorGroup\": \"dell\", \"criticality\": \"High\", \"notes\": \"\" } }",
    "```",
    "",
    "### Example B · STORAGE · high confidence + desired-state",
    "**Source row** (PDF estate diagram, page 7): \"Planned · 2x Dell PowerStore 5200 at DR site for Q2 2027\"",
    "**Reasoning**: vendor Dell + product PowerStore (explicit) → layer storage (general-purpose array, not purpose-built for protection) · environment DR site · state \"desired\" (planned signal) · criticality Medium (default for desired without explicit signal).",
    "**JSON**:",
    "```json",
    "{ \"confidence\": \"high\", \"rationale\": \"PDF estate diagram page 7\", \"data\": { \"state\": \"desired\", \"layerId\": \"storage\", \"environmentId\": \"" + exampleEnv.uuid + "\", \"label\": \"PowerStore 5200 (planned 2x)\", \"vendor\": \"Dell\", \"vendorGroup\": \"dell\", \"criticality\": \"Medium\", \"notes\": \"Q2 2027 deployment\" } }",
    "```",
    "",
    "### Example C · VIRTUALIZATION · high confidence",
    "**Source row** (CSV inventory, row 22): \"VMware vSphere 8 / vCenter, Site A, manages the prod PowerEdge cluster\"",
    "**Reasoning**: vendor VMware + product vSphere/vCenter (explicit) → layer virtualization — this is the SOFTWARE that defines the compute resources, not the hardware itself (the hardware is the separate Example A item) · environment Site A · state \"current\" (manages existing cluster) · criticality High (the management plane for a mission-critical cluster). The same rule applies to software-defined storage (e.g. VMware vSAN) — it is `virtualization`, not `storage`, because it's a software layer over hardware.",
    "**JSON**:",
    "```json",
    "{ \"confidence\": \"high\", \"rationale\": \"CSV inventory row 22\", \"data\": { \"state\": \"current\", \"layerId\": \"virtualization\", \"environmentId\": \"" + exampleEnv.uuid + "\", \"label\": \"VMware vSphere / vCenter (prod cluster)\", \"vendor\": \"VMware\", \"vendorGroup\": \"nonDell\", \"criticality\": \"High\", \"notes\": \"Manages PowerEdge R760 32-node cluster\" } }",
    "```",
    "",
    "### Example D · DATA PROTECTION · high confidence",
    "**Source row** (Excel install-base, row 41): \"Veeam Backup & Replication, nightly backups of prod VMs to DR site\"",
    "**Reasoning**: vendor Veeam + product Backup & Replication (explicit) → layer dataProtection — this is storage-shaped (it writes backup data) but purpose-built to keep data safe, so it is `dataProtection`, never `storage` · environment Site A (source of the backup job) · state \"current\" · criticality High (backup loss = data loss).",
    "**JSON**:",
    "```json",
    "{ \"confidence\": \"high\", \"rationale\": \"Excel install-base row 41\", \"data\": { \"state\": \"current\", \"layerId\": \"dataProtection\", \"environmentId\": \"" + exampleEnv.uuid + "\", \"label\": \"Veeam Backup & Replication (nightly to DR)\", \"vendor\": \"Veeam\", \"vendorGroup\": \"nonDell\", \"criticality\": \"High\", \"notes\": \"\" } }",
    "```",
    "",
    "### Example E · INFRASTRUCTURE · medium confidence + null state",
    "**Source row** (TXT memo): \"Cisco Nexus fabric and Palo Alto firewalls protect the prod DCs\"",
    "**Reasoning**: vendor Cisco/Palo Alto + product Nexus/firewall (explicit) → layer infrastructure — networking and security devices are both folded into this one layer along with load balancers, DNS, and SMTP-type services · environment ambiguous (\"prod DCs\" could be multiple) · state null (source is silent on current vs desired · sentence reads descriptive) · criticality High (on the prod path).",
    "**JSON**:",
    "```json",
    "{ \"confidence\": \"medium\", \"rationale\": \"TXT memo · 'prod DCs' ambiguous; mapped to first DC env\", \"data\": { \"state\": null, \"layerId\": \"infrastructure\", \"environmentId\": \"" + exampleEnv.uuid + "\", \"label\": \"Cisco Nexus + Palo Alto NGFW (DC fabric)\", \"vendor\": \"Cisco / Palo Alto\", \"vendorGroup\": \"nonDell\", \"criticality\": \"High\", \"notes\": \"\" } }",
    "```",
    "",
    "### Example F · WORKLOAD · low confidence",
    "**Source row** (Excel, row 33): \"SAP\"",
    "**Reasoning**: vendor SAP (explicit) but product / version / environment / criticality all missing · layer workload (SAP is a business application — it delivers business value, which is what defines this layer) · state null (silent) · criticality Medium (default). Had the row instead read \"Epic EHR system\", the layer would still be `workload` — the business it serves (healthcare) doesn't change the layer, only the vertical context.",
    "**JSON**:",
    "```json",
    "{ \"confidence\": \"low\", \"rationale\": \"Excel row 33 · only vendor cited; product/version/environment all ambiguous\", \"data\": { \"state\": null, \"layerId\": \"workload\", \"environmentId\": \"" + exampleEnv.uuid + "\", \"label\": \"SAP (details TBC)\", \"vendor\": \"SAP\", \"vendorGroup\": \"nonDell\", \"criticality\": \"Medium\", \"notes\": \"Source under-specified · engineer to confirm\" } }",
    "```",
    "",
    "### Counter-examples · do NOT do these",
    "",
    "**Wrong (invented UUID)**: ",
    "```json",
    "{ \"confidence\": \"high\", \"rationale\": \"row 5\", \"data\": { \"state\": \"current\", \"layerId\": \"compute\", \"environmentId\": \"new-datacenter-uuid\", \"label\": \"...\", ... } }",
    "```",
    "→ `environmentId` MUST be from §2. Inventing UUIDs causes the entire import to reject at drift-check.",
    "",
    "**Wrong (prose around JSON)**: ",
    "> \"Here are the extracted instances:```json {...} ``` Let me know if you need more!\"",
    "→ Emit ONLY the JSON object. No greeting, no closing, no markdown fences. The Discovery Canvas parses your output directly.",
    "",
    "**Wrong (skipped confidence)**: ",
    "```json",
    "{ \"data\": { \"state\": \"current\", ... } }",
    "```",
    "→ Every items[] entry MUST have `confidence` + `rationale`. The engineer uses these to triage rows in the preview modal.",
    "",
    "**Wrong (fabricated state)**: marking `state: \"desired\"` for a row whose source clearly describes existing infrastructure.",
    "→ When the source is ambiguous, use `state: null`. Inventing a state is dishonest about ambiguity.",
    ""
  );

  // ─── 10 · VERIFICATION CHECKLIST ────────────────────────────────────
  sections.push(
    "## 10. Verification checklist · run BEFORE emitting your response",
    "",
    "Before you emit the JSON, self-check each item in this list:",
    "",
    "- [ ] Output is ONLY the JSON object · no prose around it, no markdown code-fence wrappers, no commentary lines.",
    "- [ ] The JSON parses · braces balance, commas correct, all strings quoted.",
    "- [ ] `schemaVersion` is exactly `\"1.0\"` and `kind` is exactly `\"instance.add\"`.",
    "- [ ] Every `items[].data.environmentId` is one of the UUIDs in §2 (verbatim · spell-check the UUID).",
    "- [ ] Every `items[].data.layerId` is one of: workload, virtualization, compute, storage, dataProtection, infrastructure.",
    "- [ ] Every `items[].data.vendorGroup` is one of: dell, nonDell, custom (exact case).",
    "- [ ] Every `items[].data.criticality` is one of: High, Medium, Low (capitalized).",
    "- [ ] Every `items[].data.state` is one of: \"current\", \"desired\", null (not the string \"null\").",
    "- [ ] Every `items[]` entry has `confidence` + `rationale` set.",
    "- [ ] No `label` exceeds 60 chars · no `notes` exceeds 200 chars.",
    "- [ ] Counts are sane · if the source file has ~30 technology rows, your items[] should have roughly that count; if you emit 3 items[], you've under-extracted.",
    ""
  );

  // ─── 11 · STRICT-MATCH WARNING ──────────────────────────────────────
  sections.push(
    "## 11. Strict matching warning",
    "",
    "**Strict matching**: the JSON response must reference exactly the environments listed in §2 above. If the engineer adds or removes environments between generating these instructions and uploading the LLM's response, the Discovery Canvas will reject the response — re-generate instructions and re-run the LLM with the fresh context.",
    "",
    "There is no partial apply, no fuzzy remap, no UUID coercion. The response either fully matches the current engagement state or is rejected outright.",
    ""
  );

  // ─── 12 · READY-TO-PASTE SYSTEM PROMPT ──────────────────────────────
  sections.push(
    "## 12. System prompt body (paste verbatim to the Dell internal LLM)",
    "",
    "```",
    "You are an extraction specialist assisting a Dell Technologies presales engineer running a Discovery Canvas workshop with " + customerName + " (" + customerVertical + " · " + customerRegion + "). The engineer has attached a customer-provided source file.",
    "",
    "Your task: extract technology instances from that file and output them in the canonical Dell Discovery Canvas import-subset JSON shape (defined in §6 of the instructions document above). Apply the chain-of-thought reasoning pattern in §5 to each row. Use the worked examples in §9 as your accuracy reference. Run the verification checklist in §10 BEFORE emitting your response.",
    "",
    "Map every extracted item to one of the environment UUIDs listed in §2 (verbatim · no inventions). Set state hints per §8 guidance, confidence per §7. Never invent UUIDs, vendors, or data not in the source. If a field is missing or ambiguous, set confidence:\"low\", set state:null when the source is silent on state, and explain the ambiguity in the rationale field.",
    "",
    "Output ONLY the JSON object · no prose, no markdown fences, no commentary. The response is parsed by Zod and rejected on any deviation from §6 shape.",
    "```",
    ""
  );

  sections.push(
    "---",
    "",
    "*Generated by Dell Discovery Canvas · " + now.toISOString() + " · file: " + filename + " · BUG-055 craft pass*"
  );

  return {
    filename: filename,
    content:  sections.join("\n")
  };
}
