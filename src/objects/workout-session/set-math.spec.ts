import {
  isDropSet,
  setTotalReps,
  setVolume,
  topReps,
  topWeight,
} from './set-math';

/**
 * The whole point of this module is one asymmetry: **drops are volume, never
 * strength.** These tests exist to make that asymmetry fail loudly if anyone
 * later "fixes" it into consistency.
 */

/** 8 @ 60kg to failure, then 6 @ 40kg, then 5 @ 25kg without rest. */
const dropSet = {
  reps: 8,
  weight: 60,
  rpe: 10,
  drops: [
    { reps: 6, weight: 40 },
    { reps: 5, weight: 25 },
  ],
};

const plainSet = { reps: 8, weight: 60 };

describe('set-math', () => {
  describe('volume counts everything', () => {
    it('adds each drop to the top portion', () => {
      // 480 + 240 + 125
      expect(setVolume(dropSet)).toBe(845);
    });

    it('matches a plain set when there are no drops', () => {
      expect(setVolume(plainSet)).toBe(480);
    });

    it('treats an absent drops array as no drops', () => {
      expect(setVolume({ reps: 5, weight: 100 })).toBe(500);
      expect(setVolume({ reps: 5, weight: 100, drops: [] })).toBe(500);
    });

    it('counts reps across the whole sequence', () => {
      expect(setTotalReps(dropSet)).toBe(19);
      expect(setTotalReps(plainSet)).toBe(8);
    });

    it('survives a bodyweight drop set, where weight is 0', () => {
      const bodyweight = { reps: 12, weight: 0, drops: [{ reps: 8, weight: 0 }] };
      expect(setVolume(bodyweight)).toBe(0);
      expect(setTotalReps(bodyweight)).toBe(20);
    });
  });

  describe('strength counts only the top portion', () => {
    /**
     * The reason this module exists. Six reps at 40kg seconds after failing at
     * 60kg is real work and belongs in volume — but it is not evidence that six
     * fresh reps at 40kg are available, and Epley does not know the difference.
     */
    it('ignores the drops entirely', () => {
      expect(topWeight(dropSet)).toBe(60);
      expect(topReps(dropSet)).toBe(8);
    });

    /**
     * The specific failure this prevents, with numbers that actually occur.
     *
     * A small stack drop — 50kg to 45kg on a machine — then grinding out reps
     * pre-fatigued. Epley ranks that drop *above* the top set (66.0 against
     * 63.3), so anything scoring drops as if they were sets would record a
     * personal best the user never set. The exclusion is what protects the
     * figure; the arithmetic does not protect it on its own.
     */
    it('does not let a small drop with many reps outrank the top set', () => {
      const epley = (w: number, r: number) => w * (1 + r / 30);
      const machineDrop = {
        reps: 8,
        weight: 50,
        drops: [{ reps: 14, weight: 45 }],
      };

      const fromTop = epley(topWeight(machineDrop), topReps(machineDrop));
      const fromDrop = epley(
        machineDrop.drops[0].weight,
        machineDrop.drops[0].reps,
      );

      // The trap is real: the drop scores higher.
      expect(fromDrop).toBeGreaterThan(fromTop);

      // And the strength reading ignores it anyway.
      expect(topWeight(machineDrop)).toBe(50);
      expect(topReps(machineDrop)).toBe(8);

      // While the work still counts toward volume: 400 + 630.
      expect(setVolume(machineDrop)).toBe(1030);
    });

    it('reads a plain set unchanged', () => {
      expect(topWeight(plainSet)).toBe(60);
      expect(topReps(plainSet)).toBe(8);
    });
  });

  describe('identifying one', () => {
    it('is a drop set only when a drop was actually recorded', () => {
      expect(isDropSet(dropSet)).toBe(true);
      expect(isDropSet(plainSet)).toBe(false);
      expect(isDropSet({ reps: 5, weight: 50, drops: [] })).toBe(false);
    });
  });
});
