import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

type Result<T> = { data: T | null; error: { message: string } | null };

/** Returns the rows of a Supabase result, or throws its error. */
export function rows<T>(res: Result<unknown>): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

/** Runs `load` every time the screen gains focus (e.g. when returning from a form). */
export function useFocusData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadRef
        .current()
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        })
        .catch((e: Error) => alive && setError(e.message));
      return () => {
        alive = false;
      };
    }, []),
  );

  return { data, error };
}
