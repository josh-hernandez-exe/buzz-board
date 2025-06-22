import esbuild from "esbuild";
import tsconfigPaths from "@esbuild-plugins/tsconfig-paths";

esbuild
  .build({
    entryPoints: ["scripts/k6/test-worker.ts"],
    bundle: true,
    outfile: "scripts/k6/dist/test-worker.js",
    format: "esm",
    tsconfig: "scripts/k6/tsconfig.json",
    external: ["k6", "k6/*"],
    plugins: [tsconfigPaths({ tsconfig: "scripts/k6/tsconfig.json" })],
  })
  .catch(() => process.exit(1));
