/**
 * The shipped programme templates.
 *
 * Kept as data in the source tree for the same reason the exercise catalogue
 * is: a diff shows exactly which day of which programme changed, and there is
 * no admin screen to build and guard for content that changes when the code
 * changes.
 *
 * The gap analysis called this "training decisions that need to be defined
 * before a generator can be written", and that is exactly why it is a table
 * and not a model. 5/3/1's percentages are not a preference — they are the
 * programme. A template that made them up each time would not be 5/3/1, and
 * "generate me a PPL split" is a question with a known answer that thousands
 * of lifters already run.
 *
 * Exercises are referenced by catalogue **slug**, and materialised through
 * `ExerciseService` at the moment a plan is created. That is the one coupling
 * worth stating: a template holds an identity, never a display name, so the
 * plan a user gets is written in their own language and a catalogue rename
 * never leaves a template pointing at a lift that no longer reads correctly.
 *
 * Loads are expressed as a percentage of an estimated one-rep max where the
 * programme prescribes one, and left `null` where it does not — a hypertrophy
 * template says "three sets of ten", not "three sets of ten at 68%", and
 * inventing the number would be a worse lie than omitting it.
 */

export type TemplateGoal = 'strength' | 'hypertrophy' | 'general';

export interface TemplateSet {
  reps: number;
  /**
   * Percent of estimated 1RM. `null` means the programme does not prescribe a
   * load, and the plan is written with whatever the user last lifted instead.
   */
  percentOfOneRepMax: number | null;
  /** Marks an AMRAP top set, which is how 5/3/1 measures progress at all. */
  amrap?: boolean;
}

export interface TemplateExercise {
  /** Catalogue slug. Resolved to the user's language when the plan is built. */
  slug: string;
  sets: TemplateSet[];
}

export interface TemplateDay {
  nameEn: string;
  nameHe: string;
  /**
   * Position in the cycle, not a weekday. The user picks which real days to
   * train on; a template that hard-coded Monday would be wrong for anyone who
   * lifts on a different schedule, and 0 = Sunday here would silently claim
   * one.
   */
  order: number;
  exercises: TemplateExercise[];
}

export interface PeriodizationTemplate {
  id: string;
  nameEn: string;
  nameHe: string;
  descriptionEn: string;
  descriptionHe: string;
  goal: TemplateGoal;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  daysPerWeek: number;
  /** Weeks before the programme repeats. 1 means every week is the same. */
  cycleWeeks: number;
  days: TemplateDay[];
}

/** Three straight sets of the same thing, the shape most accessories take. */
const straight = (
  sets: number,
  reps: number,
  percent: number | null = null,
): TemplateSet[] => Array.from({ length: sets }, () => ({ reps, percentOfOneRepMax: percent }));

/**
 * 5/3/1's week-one main lift: 65/75/85, the last set taken to failure.
 *
 * Only week one is shipped. The programme's other three weeks are the same
 * structure at different percentages, and materialising all four would create
 * a plan the user has to remember to advance by hand — which is a scheduling
 * feature, not a template. This gives the shape; progression is the overload
 * coach's job, and it already reads the log.
 */
const wendlerMain = (slug: string): TemplateExercise => ({
  slug,
  sets: [
    { reps: 5, percentOfOneRepMax: 65 },
    { reps: 5, percentOfOneRepMax: 75 },
    { reps: 5, percentOfOneRepMax: 85, amrap: true },
  ],
});

export const PERIODIZATION_TEMPLATES: PeriodizationTemplate[] = [
  // ─── 5/3/1 ────────────────────────────────────────────────────
  {
    id: 'wendler-531',
    nameEn: '5/3/1',
    nameHe: '5/3/1',
    descriptionEn:
      'One main barbell lift per day at a percentage of your estimated max, with the last set taken to failure. Slow, boring, and it works.',
    descriptionHe:
      'תרגיל מוט מרכזי אחד ליום באחוז מהמקסימום המשוער שלך, כשהסט האחרון נלקח עד כישלון. איטי, משעמם, ועובד.',
    goal: 'strength',
    difficulty: 'intermediate',
    daysPerWeek: 4,
    cycleWeeks: 4,
    days: [
      {
        nameEn: 'Overhead Press',
        nameHe: 'לחיצת כתפיים',
        order: 0,
        exercises: [
          wendlerMain('overhead-press'),
          { slug: 'chin-up', sets: straight(5, 10) },
          { slug: 'triceps-pushdown', sets: straight(3, 12) },
        ],
      },
      {
        nameEn: 'Deadlift',
        nameHe: 'מתים',
        order: 1,
        exercises: [
          wendlerMain('deadlift'),
          { slug: 'hanging-leg-raise', sets: straight(5, 12) },
          { slug: 'back-extension', sets: straight(3, 12) },
        ],
      },
      {
        nameEn: 'Bench Press',
        nameHe: 'לחיצת חזה',
        order: 2,
        exercises: [
          wendlerMain('barbell-bench-press'),
          { slug: 'dumbbell-row', sets: straight(5, 10) },
          { slug: 'dumbbell-bench-press', sets: straight(3, 12) },
        ],
      },
      {
        nameEn: 'Squat',
        nameHe: 'סקוואט',
        order: 3,
        exercises: [
          wendlerMain('back-squat'),
          { slug: 'lying-leg-curl', sets: straight(5, 10) },
          { slug: 'hanging-leg-raise', sets: straight(3, 15) },
        ],
      },
    ],
  },

  // ─── push / pull / legs ───────────────────────────────────────
  {
    id: 'ppl',
    nameEn: 'Push / Pull / Legs',
    nameHe: 'דחיפה / משיכה / רגליים',
    descriptionEn:
      'Six days across two rotations, grouping every muscle by what it does rather than by where it is. The default split once three days a week stops being enough.',
    descriptionHe:
      'שישה ימים בשתי סבבים, שמקבצים כל שריר לפי מה שהוא עושה ולא לפי איפה הוא נמצא. הפיצול המקובל ברגע ששלוש פעמים בשבוע כבר לא מספיקות.',
    goal: 'hypertrophy',
    difficulty: 'intermediate',
    daysPerWeek: 6,
    cycleWeeks: 1,
    days: [
      {
        nameEn: 'Push',
        nameHe: 'דחיפה',
        order: 0,
        exercises: [
          { slug: 'barbell-bench-press', sets: straight(4, 8) },
          { slug: 'overhead-press', sets: straight(3, 10) },
          { slug: 'incline-dumbbell-press', sets: straight(3, 12) },
          { slug: 'lateral-raise', sets: straight(3, 15) },
          { slug: 'triceps-pushdown', sets: straight(3, 12) },
        ],
      },
      {
        nameEn: 'Pull',
        nameHe: 'משיכה',
        order: 1,
        exercises: [
          { slug: 'barbell-row', sets: straight(4, 8) },
          { slug: 'lat-pulldown', sets: straight(3, 10) },
          { slug: 'seated-cable-row', sets: straight(3, 12) },
          { slug: 'face-pull', sets: straight(3, 15) },
          { slug: 'barbell-curl', sets: straight(3, 12) },
        ],
      },
      {
        nameEn: 'Legs',
        nameHe: 'רגליים',
        order: 2,
        exercises: [
          { slug: 'back-squat', sets: straight(4, 8) },
          { slug: 'romanian-deadlift', sets: straight(3, 10) },
          { slug: 'leg-press', sets: straight(3, 12) },
          { slug: 'lying-leg-curl', sets: straight(3, 12) },
          { slug: 'standing-calf-raise', sets: straight(4, 15) },
        ],
      },
      {
        nameEn: 'Push',
        nameHe: 'דחיפה',
        order: 3,
        exercises: [
          { slug: 'incline-barbell-bench-press', sets: straight(4, 8) },
          { slug: 'dumbbell-shoulder-press', sets: straight(3, 10) },
          { slug: 'cable-fly', sets: straight(3, 15) },
          { slug: 'lateral-raise', sets: straight(3, 15) },
          { slug: 'overhead-triceps-extension', sets: straight(3, 12) },
        ],
      },
      {
        nameEn: 'Pull',
        nameHe: 'משיכה',
        order: 4,
        exercises: [
          { slug: 'deadlift', sets: straight(3, 5) },
          { slug: 'pull-up', sets: straight(3, 8) },
          { slug: 't-bar-row', sets: straight(3, 10) },
          { slug: 'rear-delt-fly', sets: straight(3, 15) },
          { slug: 'hammer-curl', sets: straight(3, 12) },
        ],
      },
      {
        nameEn: 'Legs',
        nameHe: 'רגליים',
        order: 5,
        exercises: [
          { slug: 'front-squat', sets: straight(4, 8) },
          { slug: 'hip-thrust', sets: straight(3, 10) },
          { slug: 'walking-lunge', sets: straight(3, 12) },
          { slug: 'seated-leg-curl', sets: straight(3, 12) },
          { slug: 'seated-calf-raise', sets: straight(4, 15) },
        ],
      },
    ],
  },

  // ─── upper / lower ────────────────────────────────────────────
  {
    id: 'upper-lower',
    nameEn: 'Upper / Lower',
    nameHe: 'פלג גוף עליון / תחתון',
    descriptionEn:
      'Four days, each half of the body twice a week. The best return on four training days, and the easiest split to keep to when a week goes wrong.',
    descriptionHe:
      'ארבעה ימים, כל חצי גוף פעמיים בשבוע. התשואה הטובה ביותר על ארבעה ימי אימון, והפיצול הכי קל להיצמד אליו כששבוע משתבש.',
    goal: 'general',
    difficulty: 'beginner',
    daysPerWeek: 4,
    cycleWeeks: 1,
    days: [
      {
        nameEn: 'Upper',
        nameHe: 'פלג גוף עליון',
        order: 0,
        exercises: [
          { slug: 'barbell-bench-press', sets: straight(4, 8) },
          { slug: 'barbell-row', sets: straight(4, 8) },
          { slug: 'overhead-press', sets: straight(3, 10) },
          { slug: 'lat-pulldown', sets: straight(3, 12) },
          { slug: 'barbell-curl', sets: straight(3, 12) },
          { slug: 'triceps-pushdown', sets: straight(3, 12) },
        ],
      },
      {
        nameEn: 'Lower',
        nameHe: 'פלג גוף תחתון',
        order: 1,
        exercises: [
          { slug: 'back-squat', sets: straight(4, 8) },
          { slug: 'romanian-deadlift', sets: straight(3, 10) },
          { slug: 'leg-press', sets: straight(3, 12) },
          { slug: 'lying-leg-curl', sets: straight(3, 12) },
          { slug: 'standing-calf-raise', sets: straight(4, 15) },
          { slug: 'plank', sets: straight(3, 60) },
        ],
      },
      {
        nameEn: 'Upper',
        nameHe: 'פלג גוף עליון',
        order: 2,
        exercises: [
          { slug: 'incline-dumbbell-press', sets: straight(4, 10) },
          { slug: 'seated-cable-row', sets: straight(4, 10) },
          { slug: 'dumbbell-shoulder-press', sets: straight(3, 12) },
          { slug: 'pull-up', sets: straight(3, 8) },
          { slug: 'hammer-curl', sets: straight(3, 12) },
          { slug: 'skull-crusher', sets: straight(3, 12) },
        ],
      },
      {
        nameEn: 'Lower',
        nameHe: 'פלג גוף תחתון',
        order: 3,
        exercises: [
          { slug: 'deadlift', sets: straight(3, 5) },
          { slug: 'front-squat', sets: straight(3, 8) },
          { slug: 'walking-lunge', sets: straight(3, 12) },
          { slug: 'seated-leg-curl', sets: straight(3, 12) },
          { slug: 'seated-calf-raise', sets: straight(4, 15) },
          { slug: 'hanging-leg-raise', sets: straight(3, 12) },
        ],
      },
    ],
  },
];

export const TEMPLATE_IDS = PERIODIZATION_TEMPLATES.map(
  (template) => template.id,
);

export function findTemplate(id: string): PeriodizationTemplate | undefined {
  return PERIODIZATION_TEMPLATES.find((template) => template.id === id);
}
