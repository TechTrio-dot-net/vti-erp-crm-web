"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./api";

interface State<T> {
  key: string | null;
  data?: T;
  error?: ApiError;
}

/**
 * GET a resource and keep it in component state. Pass null to skip.
 * Previous data stays visible while a new path or reload is loading.
 */
export function useApi<T>(path: string | null) {
  const [version, setVersion] = useState(0);
  const key = path ? `${path}#${version}` : null;
  const [state, setState] = useState<State<T>>({ key: null });

  useEffect(() => {
    if (!key || !path) return;
    let cancelled = false;

    api
      .get<T>(path)
      .then((data) => !cancelled && setState({ key, data }))
      .catch((error: ApiError) => !cancelled && setState((prev) => ({ key, data: prev.data, error })));

    return () => {
      cancelled = true;
    };
  }, [key, path]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return {
    data: state.data,
    error: state.key === key ? state.error : undefined,
    loading: key !== null && state.key !== key,
    reload,
  };
}
