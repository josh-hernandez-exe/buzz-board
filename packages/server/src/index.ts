import cors from "cors";
import { createHTTPServer } from "@trpc/server/adapters/standalone";

import { seedDb } from "@/db";

// NOTE: any imports related to CREATING the app router must be
//       relative imports. Otherwise type checking on the client side
//       is affected
import { appRouter } from "./router";

// only export *type signature* of router!
// to avoid accidentally importing your API
// into client-side code
export type AppRouter = typeof appRouter;

await seedDb();

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
