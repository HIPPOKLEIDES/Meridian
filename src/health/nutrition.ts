import type { DateKey } from '../types';
import type { Ingredient, Lifestyle, Macros, MealPlan, Measurement, Metric, NutritionProfile, Recipe, WorkoutIntensity } from './types';
import { dailySeries } from './projection';
import { fromKey } from '../lib/dates';

export const LB_PER_KG = 2.20462;
/** The common "3,500 kcal per pound" rule; real change slows as the body adapts, so treat it as a starting point. */
export const KCAL_PER_LB = 3500;

export const LIFESTYLES: { id: Lifestyle; label: string; hint: string; factor: number }[] = [
  { id: 'sedentary', label: 'Mostly sitting', hint: 'Desk job, little walking', factor: 1.2 },
  { id: 'light', label: 'Some walking', hint: 'On your feet part of the day', factor: 1.35 },
  { id: 'active', label: 'On your feet', hint: 'Retail, teaching, lots of walking', factor: 1.5 },
  { id: 'physical', label: 'Physical work', hint: 'Construction, farm or warehouse work', factor: 1.7 },
];

/** Metabolic equivalents for each intensity; workout calories = (MET − 1) × kg × hours on top of the lifestyle baseline. */
export const INTENSITIES: { id: WorkoutIntensity; label: string; examples: string; met: number }[] = [
  { id: 'light', label: 'Light', examples: 'brisk walk, easy yoga', met: 3.5 },
  { id: 'moderate', label: 'Moderate', examples: 'weights, easy cycling, climbing', met: 6 },
  { id: 'vigorous', label: 'Vigorous', examples: 'running, HIIT, hard cycling', met: 9 },
];

export const ageOn = (birthDate: DateKey, on: DateKey) => {
  const b = fromKey(birthDate);
  const d = fromKey(on);
  let age = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) age--;
  return age;
};

/** Latest weight in kg from the Weight measurement, else the profile's fallback. */
export function currentWeight(profile: NutritionProfile, metrics: Metric[], measurements: Measurement[]) {
  const metric = metrics.find((m) => m.source === 'weight') ?? metrics.find((m) => /weight/i.test(m.name));
  const imperial = !metric || !/kg/i.test(metric.unit);
  const series = metric ? dailySeries(metric, measurements) : [];
  const latest = series[series.length - 1];
  if (latest) return { kg: imperial ? latest.value / LB_PER_KG : latest.value, date: latest.date as DateKey | null, imperial, fromReading: true };
  return { kg: profile.weightKg, date: null, imperial, fromReading: false };
}

export interface DayNeed {
  weekday: number;
  workouts: { name: string; minutes: number; calories: number }[];
  /** Maintenance calories for the day. */
  maintenance: number;
  target: number;
}

export interface WeeklyNeeds {
  missing: string[];
  bmr: number;
  baseline: number;
  /** Calories per day from the weight goal (negative for a deficit). */
  goalAdjustment: number;
  days: DayNeed[];
  weekTarget: number;
  weekMaintenance: number;
  protein: number;
  fat: number;
  carbsAvg: number;
  warnings: string[];
}

/**
 * Daily and weekly calorie targets. BMR uses Mifflin-St Jeor:
 *   10 × kg + 6.25 × cm − 5 × age + (5 for men, −161 for women).
 */
export function weeklyNeeds(profile: NutritionProfile, weightKg: number | null, today: DateKey, imperial: boolean): WeeklyNeeds {
  const missing: string[] = [];
  if (!profile.sex) missing.push('sex');
  if (!profile.birthDate) missing.push('birth date');
  if (!profile.heightCm) missing.push('height');
  if (!weightKg) missing.push('weight');
  const empty: WeeklyNeeds = { missing, bmr: 0, baseline: 0, goalAdjustment: 0, days: [], weekTarget: 0, weekMaintenance: 0, protein: 0, fat: 0, carbsAvg: 0, warnings: [] };
  if (missing.length) return empty;

  const kg = weightKg!;
  const age = ageOn(profile.birthDate!, today);
  const bmr = 10 * kg + 6.25 * profile.heightCm! - 5 * age + (profile.sex === 'male' ? 5 : -161);
  const factor = LIFESTYLES.find((l) => l.id === profile.lifestyle)?.factor ?? 1.2;
  const baseline = bmr * factor;
  const kcalPerUnit = imperial ? KCAL_PER_LB : KCAL_PER_LB * LB_PER_KG;
  const rate = profile.goal === 'maintain' ? 0 : Math.abs(profile.ratePerWeek);
  const goalAdjustment = ((profile.goal === 'lose' ? -1 : 1) * rate * kcalPerUnit) / 7;

  const days: DayNeed[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const workouts = profile.workouts
      .filter((w) => w.days.includes(weekday) && w.minutes > 0)
      .map((w) => {
        const met = INTENSITIES.find((i) => i.id === w.intensity)?.met ?? 6;
        return { name: w.name, minutes: w.minutes, calories: (met - 1) * kg * (w.minutes / 60) };
      });
    const maintenance = baseline + workouts.reduce((s, w) => s + w.calories, 0);
    return { weekday, workouts, maintenance, target: maintenance + goalAdjustment };
  });

  const weekTarget = days.reduce((s, d) => s + d.target, 0);
  const avg = weekTarget / 7;
  const protein = profile.proteinPerKg * kg;
  const fat = (avg * profile.fatPct) / 100 / 9;
  const carbsAvg = Math.max(0, (avg - protein * 4 - fat * 9) / 4);

  const warnings: string[] = [];
  const floor = profile.sex === 'male' ? 1500 : 1200;
  const lowest = Math.min(...days.map((d) => d.target));
  if (lowest < floor) {
    warnings.push(
      `Some days come out under ${floor.toLocaleString()} kcal, a common minimum without medical supervision. Consider a slower rate, or check the plan with a doctor or dietitian.`,
    );
  }
  const rateKg = imperial ? rate / LB_PER_KG : rate;
  if (profile.goal !== 'maintain' && rateKg / kg > 0.01) {
    warnings.push(`${profile.goal === 'lose' ? 'Losing' : 'Gaining'} more than 1% of body weight a week is faster than usually recommended.`);
  }
  if (protein * 4 + fat * 9 > avg) warnings.push('Protein and fat targets add up to more than the calorie target; lower one of them.');

  return {
    missing,
    bmr,
    baseline,
    goalAdjustment,
    days,
    weekTarget,
    weekMaintenance: days.reduce((s, d) => s + d.maintenance, 0),
    protein,
    fat,
    carbsAvg,
    warnings,
  };
}

const ZERO: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

export const addMacros = (a: Macros, b: Macros, times = 1): Macros => ({
  calories: a.calories + b.calories * times,
  protein: a.protein + b.protein * times,
  carbs: a.carbs + b.carbs * times,
  fat: a.fat + b.fat * times,
});

export interface RecipeNutrition {
  total: Macros;
  perServing: Macros;
  /** Ingredients without calorie data, so totals may be low. */
  unknown: number;
  source: 'manual' | 'ingredients' | 'none';
}

export function recipeNutrition(recipe: Recipe): RecipeNutrition {
  const servings = Math.max(1, recipe.servings);
  if (recipe.manual) {
    return { total: addMacros(ZERO, recipe.manual, servings), perServing: recipe.manual, unknown: 0, source: 'manual' };
  }
  let total = { ...ZERO };
  let unknown = 0;
  let any = false;
  for (const i of recipe.ingredients) {
    if (i.calories === null) {
      unknown++;
      continue;
    }
    any = true;
    total = addMacros(total, { calories: i.calories, protein: i.protein ?? 0, carbs: i.carbs ?? 0, fat: i.fat ?? 0 });
  }
  return {
    total,
    perServing: addMacros(ZERO, total, 1 / servings),
    unknown,
    source: any ? 'ingredients' : 'none',
  };
}

export const UNIT_GRAMS: Record<string, number> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };

/** Nutrition for a linked food at a quantity and grams-per-unit. */
export const scaleFood = (per100g: Macros, quantity: number, gramsPerUnit: number): Macros => addMacros(ZERO, per100g, (quantity * gramsPerUnit) / 100);

const round1 = (v: number) => Math.round(v * 10) / 10;

export function withFoodNutrition(i: Ingredient): Ingredient {
  if (!i.food || i.quantity === null) return i;
  const m = scaleFood(i.food.per100g, i.quantity, i.food.gramsPerUnit);
  return { ...i, calories: Math.round(m.calories), protein: round1(m.protein), carbs: round1(m.carbs), fat: round1(m.fat) };
}

const FRACTIONS: Record<string, number> = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125 };
const UNIT_WORDS: Record<string, string> = {
  g: 'g', gram: 'g', grams: 'g', kg: 'kg', oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  cup: 'cup', cups: 'cup', c: 'cup', tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  ml: 'ml', l: 'l', liter: 'l', can: 'can', cans: 'can', clove: 'clove', cloves: 'clove', slice: 'slice', slices: 'slice',
  piece: 'piece', pieces: 'piece', pinch: 'pinch', handful: 'handful', bunch: 'bunch', package: 'package', pkg: 'package',
};

/** "1 1/2 lb chicken breast" → { quantity: 1.5, unit: 'lb', name: 'chicken breast' }. */
export function parseIngredientLine(line: string): { quantity: number | null; unit: string; name: string } {
  let s = line.trim().replace(/^[-•*]\s*/, '');
  for (const [ch, v] of Object.entries(FRACTIONS)) s = s.replace(new RegExp(`(\\d)?\\s*${ch}`), (_, whole) => ` ${(whole ? Number(whole) : 0) + v} `);
  const m = /^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+)|\/(\d+))?\s*(.*)$/.exec(s.trim());
  if (!m) return { quantity: null, unit: '', name: s.trim() };
  let quantity = Number(m[1]);
  if (m[2] && m[3]) quantity += Number(m[2]) / Number(m[3]);
  if (m[4]) quantity = Number(m[1]) / Number(m[4]);
  const rest = m[5].trim();
  const [first, ...others] = rest.split(/\s+/);
  const unit = UNIT_WORDS[first?.toLowerCase().replace(/\.$/, '') ?? ''];
  return unit ? { quantity, unit, name: others.join(' ').replace(/^of\s+/i, '') } : { quantity, unit: '', name: rest };
}

export interface PlanCoverage {
  made: Macros;
  servingsMade: number;
  servingsNeeded: number;
  /** Calories the prepped food should cover this week. */
  prepTarget: number;
  perServingTarget: number;
  proteinTarget: number;
  shortfall: number;
}

export function planCoverage(plan: MealPlan | undefined, recipes: Recipe[], profile: NutritionProfile, needs: WeeklyNeeds): PlanCoverage {
  let made = { ...ZERO };
  let servingsMade = 0;
  for (const item of plan?.items ?? []) {
    const recipe = recipes.find((r) => r.id === item.recipeId);
    if (!recipe) continue;
    made = addMacros(made, recipeNutrition(recipe).total, item.batches);
    servingsMade += recipe.servings * item.batches;
  }
  const covered = needs.days.filter((d) => profile.prepDays.includes(d.weekday));
  const prepTarget = covered.reduce((s, d) => s + Math.max(0, d.target - profile.otherCaloriesPerDay), 0);
  const servingsNeeded = covered.length * profile.mealsPerDay;
  // Protein from prepped food, in proportion to the calories it covers.
  const share = needs.weekTarget > 0 ? prepTarget / needs.weekTarget : 0;
  return {
    made,
    servingsMade,
    servingsNeeded,
    prepTarget,
    perServingTarget: servingsNeeded ? prepTarget / servingsNeeded : 0,
    proteinTarget: needs.protein * 7 * share,
    shortfall: prepTarget - made.calories,
  };
}

export interface ShoppingLine {
  key: string;
  name: string;
  quantity: number | null;
  unit: string;
  recipes: string[];
}

const pluralUnit = (unit: string, qty: number | null) => (!unit || qty === null || qty <= 1 || ['g', 'kg', 'oz', 'lb', 'ml', 'l', 'tbsp', 'tsp'].includes(unit) ? unit : `${unit}s`);

export const formatQuantity = (q: number | null, unit: string) => {
  if (q === null) return '';
  const nice = Math.abs(q - Math.round(q)) < 0.05 ? String(Math.round(q)) : q.toFixed(q < 10 ? 2 : 1).replace(/0+$/, '').replace(/\.$/, '');
  return `${nice}${unit ? ` ${pluralUnit(unit, q)}` : ''}`;
};

/** Every ingredient in the week's plan, scaled by batches and merged by name and unit. */
export function shoppingList(plan: MealPlan | undefined, recipes: Recipe[]): ShoppingLine[] {
  const lines = new Map<string, ShoppingLine>();
  for (const item of plan?.items ?? []) {
    const recipe = recipes.find((r) => r.id === item.recipeId);
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      const name = ing.name.trim();
      if (!name) continue;
      const key = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${ing.unit}`;
      const line = lines.get(key) ?? { key, name, quantity: null, unit: ing.unit, recipes: [] };
      if (ing.quantity !== null) line.quantity = (line.quantity ?? 0) + ing.quantity * item.batches;
      if (!line.recipes.includes(recipe.name)) line.recipes.push(recipe.name);
      lines.set(key, line);
    }
  }
  return [...lines.values()].sort((a, b) => a.name.localeCompare(b.name));
}
