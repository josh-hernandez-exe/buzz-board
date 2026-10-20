import integrationGlobalSetup from "../support/integrationGlobalSetup.ts";

/** Same interlocked reset as the integration suite: local `*test*` DB only. */
export default async function globalSetup() {
  await integrationGlobalSetup();
}
