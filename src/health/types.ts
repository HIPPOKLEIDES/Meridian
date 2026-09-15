import type { DateKey, ID } from '../types';

/** Which way is "better" for a metric, used for coloring changes. */
export type MetricDirection = 'increase' | 'decrease' | 'neutral';

/** How several readings on the same day combine into one daily value. */
export type MetricAggregate = 'last' | 'sum' | 'avg';

/** Data the Google Health API (Fitbit, Pixel Watch…) can fill in automatically. */
export type SyncedMetric = 'steps' | 'weight' | 'restingHeartRate' | 'sleep' | 'activeZoneMinutes' | 'bodyFat';

export interface Metric {
  id: ID;
  name: string;
  unit: string;
  decimals: number;
  direction: MetricDirection;
  aggregate: MetricAggregate;
  /** Filled from Google Health when connected; manual entries still allowed. */
  source: SyncedMetric | null;
  createdAt: number;
}

export interface Measurement {
  id: ID;
  metricId: ID;
  date: DateKey;
  value: number;
  note: string;
  source: 'manual' | 'google';
}

/** `reach`: get the value to a target (weight, 5K time). `average`: keep a 7-day average at or past it (steps, sleep). */
export type GoalKind = 'reach' | 'average';

export interface HealthGoal {
  id: ID;
  metricId: ID;
  kind: GoalKind;
  target: number;
  startDate: DateKey;
  deadline: DateKey | null;
  note: string;
  archived: boolean;
  createdAt: number;
}

export type InjuryStatus = 'active' | 'recovering' | 'healed';

export interface InjuryCheckIn {
  id: ID;
  date: DateKey;
  /** 0 = no pain, 10 = worst imaginable. */
  pain: number;
  /** Range of motion / function as a percentage of normal, if tracked. */
  mobility: number | null;
  note: string;
}

export interface Injury {
  id: ID;
  name: string;
  bodyPart: string;
  startedOn: DateKey;
  /** What a clinician (or you) expects, in weeks. */
  expectedWeeks: number | null;
  status: InjuryStatus;
  healedOn: DateKey | null;
  notes: string;
  /** Movements or activities to avoid while healing. */
  avoid: string;
  /** Core habits that make up the rehab routine. */
  rehabHabitIds: ID[];
  checkIns: InjuryCheckIn[];
  createdAt: number;
}

export interface GoogleHealthSettings {
  /** OAuth client ID from the user's own Google Cloud project (not a secret). */
  clientId: string;
  syncDays: number;
  lastSync: number | null;
  lastResult: string | null;
}

/** Everyday movement outside planned workouts; multiplies BMR. */
export type Lifestyle = 'sedentary' | 'light' | 'active' | 'physical';

export type WorkoutIntensity = 'light' | 'moderate' | 'vigorous';

/** A repeating workout that raises calorie needs on its days. */
export interface Workout {
  id: ID;
  name: string;
  days: number[];
  minutes: number;
  intensity: WorkoutIntensity;
}

export interface NutritionProfile {
  /** Needed for the Mifflin-St Jeor formula; null until set. */
  sex: 'male' | 'female' | null;
  birthDate: DateKey | null;
  heightCm: number | null;
  /** Used when there's no Weight reading; otherwise the latest reading wins. */
  weightKg: number | null;
  lifestyle: Lifestyle;
  workouts: Workout[];
  goal: 'lose' | 'maintain' | 'gain';
  /** Pounds or kilograms per week, following the Weight measurement's unit. */
  ratePerWeek: number;
  proteinPerKg: number;
  /** Share of calories from fat, 0–100. */
  fatPct: number;
  /** Weekdays your prepped food covers. */
  prepDays: number[];
  /** Prepped meals eaten per covered day (e.g. lunch + dinner = 2). */
  mealsPerDay: number;
  /** Calories per day from food you don't prep (snacks, eating out). */
  otherCaloriesPerDay: number;
  /** api.data.gov key for USDA FoodData Central; empty uses the shared DEMO_KEY. Never exported. */
  fdcApiKey: string;
}

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** A USDA FoodData Central food linked to an ingredient, so changing the amount rescales its nutrition. */
export interface FoodRef {
  fdcId: number;
  description: string;
  per100g: Macros;
  /** Grams in one of the ingredient's unit (1 for g, 28.35 for oz, a portion's weight…). */
  gramsPerUnit: number;
  /** Household portions from USDA, e.g. { label: 'cup', grams: 195 }. */
  portions: { label: string; grams: number }[];
}

export interface Ingredient {
  id: ID;
  name: string;
  quantity: number | null;
  unit: string;
  /** Nutrition for the quantity given; null where unknown. */
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  food: FoodRef | null;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'any';

export interface Recipe {
  id: ID;
  name: string;
  servings: number;
  mealType: MealType;
  prepMinutes: number | null;
  /** How many days it keeps in the fridge, for planning prep. */
  keepsDays: number | null;
  ingredients: Ingredient[];
  instructions: string;
  notes: string;
  sourceUrl: string;
  /** Per-serving values that override the ingredient totals (e.g. copied from the recipe site). */
  manual: Macros | null;
  createdAt: number;
}

/** What you're cooking for a week, keyed by the week's start date. */
export interface MealPlan {
  weekStart: DateKey;
  items: { id: ID; recipeId: ID; batches: number }[];
  /** Shopping-list lines already picked up. */
  checked: string[];
}

export interface HealthData {
  metrics: Metric[];
  measurements: Measurement[];
  goals: HealthGoal[];
  injuries: Injury[];
  google: GoogleHealthSettings;
  nutrition: NutritionProfile;
  recipes: Recipe[];
  mealPlans: Record<DateKey, MealPlan>;
}
