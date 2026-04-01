import {
  ExtensionContext,
  window,
  workspace,
} from "vscode";

const OPENAI_API_KEY_SECRET = "tracePilot.openaiApiKey";

let extensionContext: ExtensionContext | undefined;

export function initializeOpenAIKeyStore(context: ExtensionContext): void {
  extensionContext = context;
}

function getSecretStore() {
  if (!extensionContext) {
    throw new Error("OpenAI key store is not initialized");
  }
  return extensionContext.secrets;
}

export async function getStoredOpenAIKey(): Promise<string | undefined> {
  return getSecretStore().get(OPENAI_API_KEY_SECRET);
}

export async function setStoredOpenAIKey(apiKey: string): Promise<void> {
  await getSecretStore().store(OPENAI_API_KEY_SECRET, apiKey.trim());
}

export async function deleteStoredOpenAIKey(): Promise<void> {
  await getSecretStore().delete(OPENAI_API_KEY_SECRET);
}

export async function resolveOpenAIKey(): Promise<string | undefined> {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  const secretKey = await getStoredOpenAIKey();
  if (secretKey) {
    return secretKey;
  }

  const configKey = workspace
    .getConfiguration("tracePilot")
    .get<string>("openaiApiKey")
    ?.trim();

  if (configKey) {
    return configKey;
  }

  return undefined;
}

export async function promptForAndStoreOpenAIKey(): Promise<string | undefined> {
  const apiKey = await window.showInputBox({
    title: "Trace Pilot: Set OpenAI API Key",
    prompt: "Enter your OpenAI API key",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return "API key is required";
      }
      return undefined;
    },
  });

  if (!apiKey) {
    return undefined;
  }

  await setStoredOpenAIKey(apiKey);
  return apiKey.trim();
}

export async function getOrPromptOpenAIKey(): Promise<string> {
  const existingKey = await resolveOpenAIKey();
  if (existingKey) {
    return existingKey;
  }

  const apiKey = await promptForAndStoreOpenAIKey();
  if (apiKey) {
    return apiKey;
  }

  throw new Error("OpenAI API key is missing");
}
