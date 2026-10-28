// Minimal shared state with change notifications.
// Every module reads from and writes to one store so the map, timeline
// and panels never disagree about the current time or selected event.

export function createStore(initial) {
  let state = { ...initial };
  const subscribers = new Set();

  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      subscribers.forEach((fn) => fn(state, prev));
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
