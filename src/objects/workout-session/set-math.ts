/**
 * The arithmetic of one performed set, in one place.
 *
 * Before drop sets existed, "volume" was `weight * reps` written inline at five
 * call sites — the fatigue signal, the strength curve, the personal bests, the
 * overload coach and the weekly AI review. Adding drops to four of those five
 * by hand is how the fifth quietly keeps reporting the old number, so the rule
 * moved here and the call sites ask rather than compute.
 *
 * **The rule: drops are volume, never strength.**
 *
 * A drop happens seconds after failure, pre-fatigued. Eight reps at 40kg
 * straight after failing at 60kg is real work — it belongs in volume — but it
 * is not evidence that eight *fresh* reps at 40kg are available. Feeding it to
 * Epley would mint a personal best nobody set, and would tell the overload
 * coach the working weight is 40kg when it is 60kg.
 *
 * So: `setVolume` counts everything, and `topWeight` / `topReps` count only the
 * part performed fresh.
 */

export interface DropLike {
  reps: number;
  weight: number;
}

export interface SetLike {
  reps: number;
  weight: number;
  rpe?: number;
  drops?: DropLike[];
}

/** Work actually done, drops included. */
export function setVolume(set: SetLike): number {
  let total = (set.weight || 0) * (set.reps || 0);

  for (const drop of set.drops ?? []) {
    total += (drop.weight || 0) * (drop.reps || 0);
  }

  return total;
}

/** Reps actually performed, drops included. */
export function setTotalReps(set: SetLike): number {
  let total = set.reps || 0;

  for (const drop of set.drops ?? []) {
    total += drop.reps || 0;
  }

  return total;
}

/**
 * The load the set is worth as a strength signal — the top portion only.
 *
 * Named rather than inlined as `set.weight` so that reading a strength figure
 * out of a set is a deliberate call to something that documents why the drops
 * are missing from it.
 */
export function topWeight(set: SetLike): number {
  return set.weight || 0;
}

/** The reps the set is worth as a strength signal — the top portion only. */
export function topReps(set: SetLike): number {
  return set.reps || 0;
}

/** True when this set was taken down in weight without rest. */
export function isDropSet(set: SetLike): boolean {
  return (set.drops?.length ?? 0) > 0;
}
