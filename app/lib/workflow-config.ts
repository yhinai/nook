/** Server configuration only. Never return this object from an API or pass it to a client component. */
export type WorkflowConfig = {
  exaApiKey?: string;
  flyApiToken?: string;
  kernelApiKey?: string;
  registrationKey?: string;
};

export type WorkflowEnvironment = Record<string, unknown>;

const variables = {
  exaApiKey: "EXA_API_KEY",
  flyApiToken: "FLY_API_TOKEN",
  kernelApiKey: "KERNEL_API_KEY",
  registrationKey: "NOOK_REGISTRATION_KEY",
} as const;

function assertServer() {
  if (typeof window !== "undefined") throw new Error("Workflow configuration is server-only.");
}

/** Read worker bindings first, falling back to the server environment for absent/blank bindings. */
export function readWorkflowConfig(
  bindings: WorkflowEnvironment = {},
  environment: WorkflowEnvironment = process.env,
): WorkflowConfig {
  assertServer();
  const config: WorkflowConfig = {};
  for (const [field, variable] of Object.entries(variables)) {
    const binding = bindings[variable];
    const value = binding === undefined || binding === null || binding === "" || (typeof binding === "string" && !binding.trim())
      ? environment[variable]
      : binding;
    if (value === undefined || value === null || value === "") continue;
    // Errors identify only the variable; credential values never enter diagnostics.
    if (typeof value !== "string") throw new Error(`Invalid server configuration: ${variable}`);
    const secret = value.trim();
    if (!secret) continue;
    if (/[\r\n\0]/.test(secret)) throw new Error(`Invalid server configuration: ${variable}`);
    config[field as keyof WorkflowConfig] = secret;
  }
  return config;
}

/** Credential presence only; these flags do not claim a provider is reachable or a workflow exists. */
export function workflowCapabilities(config: WorkflowConfig) {
  assertServer();
  return {
    researchConfigured: Boolean(config.exaApiKey),
    deploymentConfigured: Boolean(config.flyApiToken),
    browserConfigured: Boolean(config.kernelApiKey),
    registrationConfigured: Boolean(config.registrationKey),
  };
}
