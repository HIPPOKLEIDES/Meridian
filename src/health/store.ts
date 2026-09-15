import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DateKey, ID } from '../types';
import type {
  GoogleHealthSettings,
  HealthData,
  HealthGoal,
  Ingredient,
  Injury,
  InjuryCheckIn,
  MealPlan,
  Measurement,
  Metric,
  NutritionProfile,
  Recipe,
  SyncedMetric,
} from './types';
import { uid } from '../store';
import { todayKey } from '../lib/dates';

export const DEFAULT_METRICS: Metric[] = [
  { id: 'weight', name: 'Weight', unit: 'lb', decimals: 1, direction: 'neutral', aggregate: 'last', source: 'weight', createdAt: 0 },
  { id: 'resting-hr', name: 'Resting heart rate', unit: 'bpm', decimals: 0, direction: 'decrease', aggregate: 'last', source: 'restingHeartRate', createdAt: 0 },
  { id: 'sleep', name: 'Sleep', unit: 'h', decimals: 1, direction: 'increase', aggregate: 'sum', source: 'sleep', createdAt: 0 },
  { id: 'steps', name: 'Steps', unit: 'steps', decimals: 0, direction: 'increase', aggregate: 'sum', source: 'steps', createdAt: 0 },
  { id: 'azm', name: 'Active zone minutes', unit: 'min', decimals: 0, direction: 'increase', aggregate: 'sum', source: 'activeZoneMinutes', createdAt: 0 },
  { id: 'body-fat', name: 'Body fat', unit: '%', decimals: 1, direction: 'decrease', aggregate: 'last', source: 'bodyFat', createdAt: 0 },
];

export const defaultNutrition = (): NutritionProfile => ({
  sex: null,
  birthDate: null,
  heightCm: null,
  weightKg: null,
  lifestyle: 'sedentary',
  workouts: [],
  goal: 'maintain',
  ratePerWeek: 0.5,
  proteinPerKg: 1.6,
  fatPct: 30,
  prepDays: [0, 1, 2, 3, 4, 5, 6],
  mealsPerDay: 2,
  otherCaloriesPerDay: 500,
  fdcApiKey: '',
});

export const emptyHealth = (): HealthData => ({
  metrics: DEFAULT_METRICS.map((m) => ({ ...m })),
  measurements: [],
  goals: [],
  injuries: [],
  google: { clientId: '', syncDays: 60, lastSync: null, lastResult: null },
  nutrition: defaultNutrition(),
  recipes: [],
  mealPlans: {},
});

export const newRecipe = (r: Partial<Recipe> = {}): Recipe => ({
  id: uid(),
  name: '',
  servings: 4,
  mealType: 'any',
  prepMinutes: null,
  keepsDays: null,
  ingredients: [],
  instructions: '',
  notes: '',
  sourceUrl: '',
  manual: null,
  createdAt: Date.now(),
  ...r,
});

export const newIngredient = (i: Partial<Ingredient> = {}): Ingredient => ({
  id: uid(),
  name: '',
  quantity: null,
  unit: '',
  calories: null,
  protein: null,
  carbs: null,
  fat: null,
  food: null,
  ...i,
});

export const newMetric = (m: Partial<Metric> = {}): Metric => ({
  id: uid(),
  name: '',
  unit: '',
  decimals: 1,
  direction: 'neutral',
  aggregate: 'last',
  source: null,
  createdAt: Date.now(),
  ...m,
});

export const newGoal = (g: Partial<HealthGoal> = {}): HealthGoal => ({
  id: uid(),
  metricId: 'weight',
  kind: 'reach',
  target: 0,
  startDate: todayKey(),
  deadline: null,
  note: '',
  archived: false,
  createdAt: Date.now(),
  ...g,
});

export const newInjury = (i: Partial<Injury> = {}): Injury => ({
  id: uid(),
  name: '',
  bodyPart: '',
  startedOn: todayKey(),
  expectedWeeks: null,
  status: 'active',
  healedOn: null,
  notes: '',
  avoid: '',
  rehabHabitIds: [],
  checkIns: [],
  createdAt: Date.now(),
  ...i,
});

interface HealthActions {
  addMetric(m: Partial<Metric>): ID;
  updateMetric(id: ID, patch: Partial<Metric>): void;
  deleteMetric(id: ID): void;
  addMeasurement(m: Omit<Measurement, 'id'>): void;
  deleteMeasurement(id: ID): void;
  /** Replace synced readings for these dates; manual readings are left alone. */
  applySynced(source: SyncedMetric, points: { date: DateKey; value: number }[]): number;
  addGoal(g: Partial<HealthGoal>): ID;
  updateGoal(id: ID, patch: Partial<HealthGoal>): void;
  deleteGoal(id: ID): void;
  addInjury(i: Partial<Injury>): ID;
  updateInjury(id: ID, patch: Partial<Injury>): void;
  deleteInjury(id: ID): void;
  addCheckIn(injuryId: ID, c: Omit<InjuryCheckIn, 'id'>): void;
  deleteCheckIn(injuryId: ID, checkInId: ID): void;
  updateGoogle(patch: Partial<GoogleHealthSettings>): void;
  updateNutrition(patch: Partial<NutritionProfile>): void;
  saveRecipe(recipe: Recipe): void;
  deleteRecipe(id: ID): void;
  /** Creates the week's plan if needed, then applies the change. */
  updateMealPlan(weekStart: DateKey, change: (plan: MealPlan) => MealPlan): void;
  replaceAll(data: HealthData): void;
}

export type HealthStore = HealthData & HealthActions;

const patch = <T extends { id: ID }>(list: T[], id: ID, p: Partial<T>) => list.map((x) => (x.id === id ? { ...x, ...p } : x));

export const useHealth = create<HealthStore>()(
  persist(
    (set, get) => ({
      ...emptyHealth(),

      addMetric: (m) => {
        const metric = newMetric(m);
        set((s) => ({ metrics: [...s.metrics, metric] }));
        return metric.id;
      },
      updateMetric: (id, p) => set((s) => ({ metrics: patch(s.metrics, id, p) })),
      deleteMetric: (id) =>
        set((s) => ({
          metrics: s.metrics.filter((m) => m.id !== id),
          measurements: s.measurements.filter((m) => m.metricId !== id),
          goals: s.goals.filter((g) => g.metricId !== id),
        })),
      addMeasurement: (m) => set((s) => ({ measurements: [...s.measurements, { ...m, id: uid() }] })),
      deleteMeasurement: (id) => set((s) => ({ measurements: s.measurements.filter((m) => m.id !== id) })),
      applySynced: (source, points) => {
        const metric = get().metrics.find((m) => m.source === source);
        if (!metric || !points.length) return 0;
        const dates = new Set(points.map((p) => p.date));
        set((s) => ({
          measurements: [
            ...s.measurements.filter((m) => !(m.metricId === metric.id && m.source === 'google' && dates.has(m.date))),
            ...points.map((p) => ({ id: uid(), metricId: metric.id, date: p.date, value: p.value, note: '', source: 'google' as const })),
          ],
        }));
        return points.length;
      },

      addGoal: (g) => {
        const goal = newGoal(g);
        set((s) => ({ goals: [...s.goals, goal] }));
        return goal.id;
      },
      updateGoal: (id, p) => set((s) => ({ goals: patch(s.goals, id, p) })),
      deleteGoal: (id) => set((s) => ({ goals: s.goals.filter((g) => g.id !== id) })),

      addInjury: (i) => {
        const injury = newInjury(i);
        set((s) => ({ injuries: [...s.injuries, injury] }));
        return injury.id;
      },
      updateInjury: (id, p) => set((s) => ({ injuries: patch(s.injuries, id, p) })),
      deleteInjury: (id) => set((s) => ({ injuries: s.injuries.filter((i) => i.id !== id) })),
      addCheckIn: (injuryId, c) =>
        set((s) => ({
          injuries: s.injuries.map((i) =>
            i.id === injuryId
              ? { ...i, checkIns: [...i.checkIns.filter((x) => x.date !== c.date), { ...c, id: uid() }] }
              : i,
          ),
        })),
      deleteCheckIn: (injuryId, checkInId) =>
        set((s) => ({
          injuries: s.injuries.map((i) =>
            i.id === injuryId ? { ...i, checkIns: i.checkIns.filter((x) => x.id !== checkInId) } : i,
          ),
        })),

      updateGoogle: (p) => set((s) => ({ google: { ...s.google, ...p } })),
      updateNutrition: (p) => set((s) => ({ nutrition: { ...s.nutrition, ...p } })),
      saveRecipe: (recipe) =>
        set((s) => ({
          recipes: s.recipes.some((r) => r.id === recipe.id) ? patch(s.recipes, recipe.id, recipe) : [...s.recipes, recipe],
        })),
      deleteRecipe: (id) =>
        set((s) => ({
          recipes: s.recipes.filter((r) => r.id !== id),
          mealPlans: Object.fromEntries(
            Object.entries(s.mealPlans).map(([k, plan]) => [k, { ...plan, items: plan.items.filter((i) => i.recipeId !== id) }]),
          ),
        })),
      updateMealPlan: (weekStart, change) =>
        set((s) => ({
          mealPlans: { ...s.mealPlans, [weekStart]: change(s.mealPlans[weekStart] ?? { weekStart, items: [], checked: [] }) },
        })),
      replaceAll: (data) => set({ ...emptyHealth(), ...data, nutrition: { ...defaultNutrition(), ...data.nutrition } }),
    }),
    {
      name: 'meridian:health',
      version: 1,
      partialize: (s): HealthData => ({
        metrics: s.metrics,
        measurements: s.measurements,
        goals: s.goals,
        injuries: s.injuries,
        google: s.google,
        nutrition: s.nutrition,
        recipes: s.recipes,
        mealPlans: s.mealPlans,
      }),
      // Profiles saved before a field existed get its default instead of undefined.
      merge: (persisted, current) => {
        const p = persisted as Partial<HealthData> | undefined;
        return { ...current, ...p, nutrition: { ...defaultNutrition(), ...p?.nutrition } };
      },
    },
  ),
);

/** Backups leave out the USDA API key, like the Google token. */
export const exportHealth = (): HealthData => {
  const { metrics, measurements, goals, injuries, google, nutrition, recipes, mealPlans } = useHealth.getState();
  return { metrics, measurements, goals, injuries, google, nutrition: { ...nutrition, fdcApiKey: '' }, recipes, mealPlans };
};
