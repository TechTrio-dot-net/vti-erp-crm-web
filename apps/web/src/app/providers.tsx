"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Any failed save/update/delete without its own error handling still tells the user what happened
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            if (mutation.options.onError) return;
            toast.error(error instanceof Error ? error.message : "Something went wrong");
          },
        }),
        defaultOptions: {
          queries: {
            staleTime:            30_000,          // 30 s — don't refetch fresh data
            gcTime:               5 * 60_000,      // 5 min in cache
            refetchOnWindowFocus: false,            // no surprise refetches
            refetchOnReconnect:   true,
            retry:                1,               // 1 retry on failure
            retryDelay:           (n) => Math.min(1000 * 2 ** n, 10_000),
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
