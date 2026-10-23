/**
 * A tRPC server caller treats every property as a procedure name, so
 * `JSON.stringify` (which reads `toJSON`) or promise resolution (which reads
 * `then`) would "call" a procedure that doesn't exist and leave a rejected
 * promise nobody handles. React's development build serializes awaited
 * values for its debug info, which did exactly that. This wrapper answers
 * those two reads with `undefined`, so the caller is safe to await and to
 * serialize.
 */
const INERT = new Set<PropertyKey>(["toJSON", "then"]);

export function inertCaller<T extends object>(caller: T): T {
  return new Proxy(caller, {
    get(target, prop, receiver) {
      if (INERT.has(prop)) return undefined;
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}
