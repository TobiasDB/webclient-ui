import * as React from "react";

/** What a media bar shows: the Player publishes it every frame. */
export type PlayerState = {
  playing: boolean; live: boolean; ready: boolean;
  time: number; total: number; startTime: number; speed: number; skip: boolean; pace: number;
  markers: { t: number; tag: string }[];
  size: { w: number; h: number }; scale: number;
};

export type PlayerActions = {
  toggle: () => void; step: (dir: 1 | -1) => void; seekFrac: (f: number) => void;
  setSpeed: (s: number) => void; setSkip: (on: boolean) => void; setPace: (ms: number) => void;
};

const INITIAL: PlayerState = { playing: false, live: false, ready: false, time: 0, total: 1, startTime: 0, speed: 1, skip: true, pace: 900, markers: [], size: { w: 1280, h: 800 }, scale: 1 };

/** The seam between a Player and its media bar: the Player writes state and registers its
 * actions; any number of bars (one docked under the page, one pinned to the window) read the
 * state and call the actions. Lets the bar live OUTSIDE the player's box -- always visible. */
export class PlayerController {
  state: PlayerState = INITIAL;
  actions: PlayerActions = { toggle() {}, step() {}, seekFrac() {}, setSpeed() {}, setSkip() {}, setPace() {} };
  private listeners = new Set<() => void>();
  set(patch: Partial<PlayerState>): void {
    let changed = false;
    for (const k of Object.keys(patch) as (keyof PlayerState)[]) if (this.state[k] !== patch[k]) { changed = true; break; }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  get = (): PlayerState => this.state;
}

export function usePlayerController(): PlayerController {
  return React.useMemo(() => new PlayerController(), []);
}

export function usePlayerState(c: PlayerController): PlayerState {
  return React.useSyncExternalStore(c.subscribe, c.get, c.get);
}
