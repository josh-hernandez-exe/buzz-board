/**
 * Whether this development server accepts connections from other machines.
 * Development sign-in refuses to run while it does (see devLoginGate.ts).
 *
 * A request can't prove it came from this machine: route handlers don't see
 * the connecting address, and Host, Origin and X-Forwarded-For are all chosen
 * by the caller. So check the server instead, by trying its own port on each
 * of this machine's network (non-loopback) addresses. `next dev` listens on
 * all of them unless it's started with `--hostname 127.0.0.1`.
 */
import { connect } from "node:net";
import { networkInterfaces } from "node:os";

const PROBE_TIMEOUT_MS = 1_000;

/** `port` defaults to the one `next dev` is listening on. */
export async function reachableFromNetwork(
  port = process.env.PORT,
): Promise<boolean> {
  const portNumber = Number(port);
  // Can't tell which port to check, so assume the worst.
  if (!Number.isInteger(portNumber) || portNumber <= 0) return true;

  const hosts = Object.entries(networkInterfaces()).flatMap(
    ([name, addresses]) =>
      (addresses ?? [])
        .filter((address) => !address.internal)
        .map((address) =>
          // Link-local IPv6 addresses only connect with their interface.
          address.family === "IPv6" && address.scopeid
            ? `${address.address}%${name}`
            : address.address,
        ),
  );
  const accepted = await Promise.all(
    hosts.map((host) => acceptsConnection(host, portNumber)),
  );
  return accepted.includes(true);
}

function acceptsConnection(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (accepted: boolean) => {
      socket.destroy();
      resolve(accepted);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    // No answer either way, so it can't be ruled out.
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(true));
  });
}
