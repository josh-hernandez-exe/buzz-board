import { useState } from "react";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { MockComponent } from "@/views/PrototypeView";
import { trpc } from "@/utils/trpc";

import "./App.css";

export function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "http://localhost:3000/",
          async headers() {
            return {
              // authorization: getAuthCookie(),
            };
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {
          <div>
            {/* <p>Hello</p> */}
            <MockComponent />
          </div>
        }
      </QueryClientProvider>
    </trpc.Provider>
  );
}
