import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolveAIConfig, aiProviderLabel } from "../lib/ai-config.ts";
import { readWorkflowConfig, workflowCapabilities } from "../lib/workflow-config.ts";

// Local diagnostics expose presence only, never credential values.
let local = {};
try { local = parseEnv(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw new Error("Could not read local workflow configuration."); }
try {
  const ai = resolveAIConfig(local);
  const capabilities = workflowCapabilities(readWorkflowConfig(local));
  console.log(JSON.stringify({ ai: { configured: Boolean(ai.key), provider: aiProviderLabel(ai), model: ai.model }, services: capabilities, implementedWorkflows: ["council", "team conversations", "tentative plan suggestions"] }, null, 2));
} catch { console.error("Workflow configuration is invalid. Check the server environment variables."); process.exitCode = 1; }
