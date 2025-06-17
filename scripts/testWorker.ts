/**
 * Vanilla tRPC client that can be used without React
 * This makes HTTP requests to your tRPC endpoints
 * bun run scripts/testWorker.ts
 */

import { createVanillaTrpcClient } from "@/trpc/vanilla-client";
// import type { PrivateGameState } from "@/types";

async function testTrpcClient() {
  let client;
  let result;

  // client = createVanillaTrpcClient({});

  // result = await client.public.joinGame.mutate({
  //   gameCode: "2H9S1A",
  //   token: "nlhM058GITQC9WB4nQwg2-kdCqvfAxSYpV2Ukf98-4Q",
  // });

  client = createVanillaTrpcClient({
    gameId: "cmbhi3m540006p2733pegdxio",
    gameUserToken: "nlhM058GITQC9WB4nQwg2-kdCqvfAxSYpV2Ukf98-4Q",
  });

  result = await client.gameGeneral.currentGameState.query();
  console.log("Game State:", result);

  result = await client.gameUser.changeTeams.mutate({
    gameTeamId: result?.gameTeams?.[0]?.id ?? "",
  });
  console.log("Change Teams Result:", result);

  result = await client.gameUser.buzzIn.mutate().catch((error) => {
    console.error("Buzz In Error:", error);
    return null;
  });
  console.log("Change Teams Result:", result);
}

// Run the test
testTrpcClient().catch(console.error);
