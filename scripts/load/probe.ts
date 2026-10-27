/**
 * A latency probe in its own process: asks the server for the public game
 * state (a small, constant-size answer) twice a second and prints how long
 * each took, plus how late its own timer fired.
 *
 * It isn't slowed by the runner's own work (parsing thousands of streams),
 * so comparing it with what the bots measure separates server slowness from
 * a saturated load generator.
 *
 *   bun scripts/load/probe.ts <origin> <gameId>
 */
const [origin, gameId] = process.argv.slice(2);
if (!origin || !gameId) {
  console.error("usage: probe.ts <origin> <gameId>");
  process.exit(2);
}
const input = encodeURIComponent(JSON.stringify({ json: { gameId } }));
const url = `${origin}/api/trpc/public.currentGameState?input=${input}`;

let expected = performance.now() + 500;
for (;;) {
  const start = performance.now();
  const lag = Math.max(0, start - expected);
  let ok = true;
  try {
    const res = await fetch(url);
    await res.arrayBuffer();
    ok = res.ok;
  } catch {
    ok = false;
  }
  const ms = performance.now() - start;
  process.stdout.write(
    `${JSON.stringify({ ms: Math.round(ms * 10) / 10, lag: Math.round(lag), ok })}\n`,
  );
  const wait = Math.max(0, 500 - (performance.now() - start));
  expected = performance.now() + wait;
  await new Promise((r) => setTimeout(r, wait));
}
