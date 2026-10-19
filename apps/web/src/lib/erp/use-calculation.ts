"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "./api";
import type { Calculation, QuotationItemInput } from "./types";

interface State {
  key: string | null;
  data?: Calculation;
  error?: ApiError;
}

/**
 * Prices quotation lines on the server (debounced). Pricing never happens in the
 * browser — this only displays what the API's PricingService returns.
 */
export function useCalculation(items: QuotationItemInput[] | null, includeGst = true, delay = 300) {
  const key = items && items.length > 0 ? JSON.stringify({ items, include_gst: includeGst }) : null;
  const [state, setState] = useState<State>({ key: null });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    const timer = setTimeout(() => {
      api
        .post<{ data: Calculation }>("/quotations/calculate", JSON.parse(key))
        .then((response) => !cancelled && setState({ key, data: response.data }))
        .catch((error: ApiError) => !cancelled && setState({ key, error }));
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, delay]);

  const current = key !== null && state.key === key;

  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: key !== null && !current,
  };
}
