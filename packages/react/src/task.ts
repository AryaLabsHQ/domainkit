/**
 * The one place the package leaves Effect. Every controller runs its transport calls through
 * `useRunner`, which interrupts the call in flight when a newer one starts or the component
 * unmounts, and drops results that arrive after either.
 */
import { DomainKitError } from "domainkit";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { useEffect, useMemo, useRef } from "react";

export interface Runner {
  /**
   * Run `effect`, replacing whatever this runner had in flight. `onSuccess` and `onFailure` fire
   * only while this call is still the newest and the component is mounted.
   */
  readonly run: <A>(
    effect: Effect.Effect<A, DomainKitError.DomainKitError>,
    handlers: {
      readonly onSuccess: (value: A) => void;
      readonly onFailure: (error: DomainKitError.DomainKitError) => void;
    },
  ) => void;
  /** Stop the call in flight without starting another. */
  readonly cancel: () => void;
}

/** A defect is not a lifecycle failure; report it in the shape the UI already renders. */
const defect = (cause: unknown): DomainKitError.DomainKitError =>
  new DomainKitError.DomainKitError({
    reason: new DomainKitError.ProviderUnavailable({
      provider: "domainkit",
      message: `The transport failed: ${String(cause)}`,
    }),
  });

interface Live {
  readonly id: number;
  interrupt: (() => void) | null;
}

export function useRunner(): Runner {
  const state = useRef<{ mounted: boolean; next: number; live: Live | null }>({
    live: null,
    mounted: true,
    next: 0,
  });
  useEffect(() => {
    const current = state.current;
    current.mounted = true;
    return () => {
      current.mounted = false;
      current.live?.interrupt?.();
      current.live = null;
    };
  }, []);
  return useMemo<Runner>(() => {
    const stop = () => {
      state.current.live?.interrupt?.();
      state.current.live = null;
    };
    return {
      cancel: stop,
      run: (effect, handlers) => {
        stop();
        const live: Live = { id: (state.current.next += 1), interrupt: null };
        state.current.live = live;
        const interrupt = Effect.runCallback(effect, {
          onExit: (exit) => {
            if (state.current.live?.id !== live.id || !state.current.mounted) return;
            state.current.live = null;
            if (Exit.isSuccess(exit)) {
              handlers.onSuccess(exit.value);
              return;
            }
            // Read both before the interrupt guard: it narrows `exit` to the success side.
            const cause = exit.cause;
            const error = Exit.findErrorOption(exit);
            if (Exit.hasInterrupts(exit)) return;
            handlers.onFailure(Option.isSome(error) ? error.value : defect(cause));
          },
        });
        // A synchronous effect already ran `onExit` and cleared `live`; only a call still in
        // flight needs an interrupt handle.
        if (state.current.live?.id === live.id) live.interrupt = () => interrupt();
      },
    };
  }, []);
}
