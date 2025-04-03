import { useState } from "react";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PrototypeSuperAdminView } from "@/views/PrototypeSuperAdminView";
import { trpc } from "@/utils/trpc";
import { logger } from "@/utils/logger";

import "./App.css";

const TRPC_BASE_URL = import.meta.env.VITE_TRPC_BASE_URL || "http://localhost:3000/";

export function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() => {
    logger.debug(`TRPC_BASE_URL: ${TRPC_BASE_URL}`);

    return trpc.createClient({
      links: [
        httpBatchLink({
          url: TRPC_BASE_URL,
          async headers() {
            return {
              // authorization: getAuthCookie(),
            };
          },
        }),
      ],
    });
  });

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <PrototypeSuperAdminView />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
