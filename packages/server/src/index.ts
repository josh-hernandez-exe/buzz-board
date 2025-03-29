import cors from "cors";
import { createHTTPServer } from "@trpc/server/adapters/standalone";

import { appRouter } from "./router";

// only export *type signature* of router!
// to avoid accidentally importing your API
// into client-side code
export type AppRouter = typeof appRouter;

const server = createHTTPServer({
  middleware: cors(),
  router: appRouter,
  createContext() {
    return {};
  },
  basePath: "/",
});

const port = 3000;

server.listen(port);
console.log(`Server listening on port ${port}`);
