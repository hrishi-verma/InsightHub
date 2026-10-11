'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Runs `load()` whenever deps change; ignores responses from superseded calls.
export function useApi(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const callId = useRef(0);

  const run = useCallback(async () => {
    const id = ++callId.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await load();
      if (id === callId.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === callId.current) setState((s) => ({ data: s.data, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, reload: run, setData: (fn) => setState((s) => ({ ...s, data: fn(s.data) })) };
}
