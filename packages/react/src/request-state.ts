import { useCallback, useEffect, useInsertionEffect, useRef, useState } from "react";

import type { DnsRecord } from "./transport.ts";

export interface Controller<State> {
  readonly begin: (state: State) => number;
  readonly commit: (request: number, state: State) => boolean;
  readonly reset: (state: State) => void;
  readonly state: State;
}

export function useController<State>(identity: string, initial: State): Controller<State> {
  const currentIdentity = useRef(identity);
  const revision = useRef(0);
  const [snapshot, setSnapshot] = useState(() => ({ identity, state: initial }));

  useInsertionEffect(() => {
    currentIdentity.current = identity;
    revision.current += 1;
  }, [identity]);

  useEffect(() => {
    setSnapshot({ identity, state: initial });
  }, [identity]);

  const begin = useCallback((state: State) => {
    const request = ++revision.current;
    setSnapshot({ identity: currentIdentity.current, state });
    return request;
  }, []);
  const commit = useCallback((request: number, state: State) => {
    if (revision.current !== request) return false;
    setSnapshot({ identity: currentIdentity.current, state });
    return true;
  }, []);
  const reset = useCallback((state: State) => {
    revision.current += 1;
    setSnapshot({ identity: currentIdentity.current, state });
  }, []);

  return {
    begin,
    commit,
    reset,
    state: snapshot.identity === identity ? snapshot.state : initial,
  };
}

export const recordsIdentity = (records: ReadonlyArray<DnsRecord>): string =>
  JSON.stringify(
    records.map((record) => [
      record.id,
      record.name,
      record.priority ?? null,
      record.type,
      record.value,
    ]),
  );
