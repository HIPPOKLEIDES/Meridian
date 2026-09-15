import type { DateKey } from '../types';
import type { HealthData, Ingredient, InjuryCheckIn, Measurement, Recipe } from './types';
import { emptyHealth, newGoal, newIngredient, newInjury, newMetric, newRecipe } from './store';
import { uid, useStore } from '../store';
import { addDays, startOfWeek, todayKey, weekday } from '../lib/dates';
import { mulberry32, SAMPLE_REHAB_HABIT_ID } from '../lib/sample';

/** Ingredient with nutrition for the stated amount (approximate USDA values). */
const ing = (name: string, quantity: number, unit: string, calories: number, protein: number, carbs: number, fat: number): Ingredient =>
  newIngredient({ name, quantity, unit, calories, protein, carbs, fat });

function sampleRecipes(): Recipe[] {
  return [
    newRecipe({
      name: 'Chicken burrito bowls',
      servings: 5,
      mealType: 'lunch',
      prepMinutes: 45,
      keepsDays: 4,
      ingredients: [
        ing('chicken breast, raw', 2, 'lb', 961, 204, 0, 17.5),
        ing('brown rice, dry', 1.5, 'cup', 1046, 21, 217, 7.7),
        ing('black beans, canned, drained', 2, 'can', 437, 29, 80, 1.4),
        ing('frozen corn', 1, 'cup', 132, 4.7, 28, 1.5),
        ing('salsa', 1.5, 'cup', 113, 6, 26, 0.7),
        ing('plain Greek yogurt, 2%', 1, 'cup', 179, 24, 9.6, 4.9),
        ing('olive oil', 2, 'tbsp', 239, 0, 0, 27),
        ing('taco seasoning', 2, 'tbsp', 55, 1, 10, 1),
      ],
      instructions: 'Cook rice. Season and roast or pan-sear the chicken, then slice. Warm beans and corn. Portion into 5 containers with salsa and yogurt on the side.',
    }),
    newRecipe({
      name: 'Turkey & bean chili',
      servings: 6,
      mealType: 'dinner',
      prepMinutes: 60,
      keepsDays: 5,
      ingredients: [
        ing('ground turkey, 93% lean', 2, 'lb', 1361, 172, 0, 73),
        ing('kidney beans, canned, drained', 2, 'can', 480, 33, 86, 2),
        ing('crushed tomatoes', 28, 'oz', 302, 13, 58, 2.4),
        ing('onion', 1, 'piece', 60, 1.7, 14, 0.2),
        ing('bell pepper', 1, 'piece', 31, 1, 7, 0.4),
        ing('olive oil', 1, 'tbsp', 119, 0, 0, 13.5),
        ing('chili powder', 3, 'tbsp', 68, 3, 12, 3.4),
      ],
      instructions: 'Brown the turkey with onion and pepper in oil. Add spices, tomatoes and beans. Simmer 30–40 minutes. Freezes well.',
      notes: 'Freeze two portions if prepping for a full week.',
    }),
    newRecipe({
      name: 'Blueberry overnight oats',
      servings: 5,
      mealType: 'breakfast',
      prepMinutes: 15,
      keepsDays: 5,
      ingredients: [
        ing('rolled oats', 2.5, 'cup', 758, 26, 135, 13),
        ing('milk, 2%', 2.5, 'cup', 305, 20, 29, 12),
        ing('plain Greek yogurt, 2%', 1.25, 'cup', 223, 30, 12, 6),
        ing('chia seeds', 5, 'tbsp', 292, 10, 25, 18),
        ing('frozen blueberries', 2.5, 'cup', 179, 1.5, 43, 2),
        ing('honey', 5, 'tsp', 106, 0, 29, 0),
      ],
      instructions: 'Stir everything together, split into 5 jars and refrigerate overnight.',
    }),
    newRecipe({
      name: 'Salmon, sweet potato & broccoli sheet pan',
      servings: 4,
      mealType: 'dinner',
      prepMinutes: 40,
      keepsDays: 3,
      ingredients: [
        ing('salmon fillets', 1.5, 'lb', 1414, 136, 0, 88),
        ing('sweet potatoes', 2, 'lb', 780, 14, 183, 0.5),
        ing('broccoli', 1.5, 'lb', 231, 19, 45, 2.5),
        ing('olive oil', 2, 'tbsp', 239, 0, 0, 27),
      ],
      instructions: 'Roast cubed sweet potato 20 minutes at 425°F, add broccoli and salmon for 12–15 more.',
    }),
  ];
}

export function sampleHealth(): HealthData {
  const rand = mulberry32(7);
  const today = todayKey();
  const d = (n: number) => addDays(today, n);
  const noise = (amp: number) => (rand() * 2 - 1) * amp;
  const data = emptyHealth();
  const m: Measurement[] = [];
  const add = (metricId: string, date: DateKey, value: number) =>
    m.push({ id: uid(), metricId, date, value, note: '', source: 'manual' });

  const fiveK = newMetric({ id: 'five-k', name: '5K run time', unit: 'min', decimals: 1, direction: 'decrease', aggregate: 'last' });
  data.metrics.push(fiveK);

  for (let i = 80; i >= 1; i--) {
    const day = d(-i);
    const t = 80 - i;
    const wd = weekday(day);
    if (rand() < 0.7) add('weight', day, Math.round((191 - t * 0.105 + noise(0.8)) * 10) / 10);
    add('resting-hr', day, Math.round(64 - t * 0.055 + noise(1.6)));
    add('sleep', day, Math.round((6.9 + noise(0.9) + (wd === 0 || wd === 6 ? 0.5 : 0)) * 100) / 100);
    add('steps', day, Math.round(8200 + noise(3800) + (wd === 0 || wd === 6 ? -1500 : 0) + t * 20));
    add('azm', day, Math.max(0, Math.round(22 + noise(20) + (wd === 1 || wd === 3 || wd === 5 ? 18 : 0))));
    if (wd === 0) add('body-fat', day, Math.round((22.6 - t * 0.022 + noise(0.3)) * 10) / 10);
    if (wd === 6) add(fiveK.id, day, Math.round((31.4 - t * 0.04 + noise(0.5)) * 10) / 10);
  }
  data.measurements = m;

  data.goals = [
    newGoal({ metricId: 'weight', kind: 'reach', target: 175, startDate: d(-80), deadline: d(100), note: 'Back to race weight before spring.' }),
    newGoal({ metricId: fiveK.id, kind: 'reach', target: 27, startDate: d(-80), note: 'Sub-27 5K.' }),
    newGoal({ metricId: 'steps', kind: 'average', target: 9000, startDate: d(-30) }),
    newGoal({ metricId: 'sleep', kind: 'average', target: 7.5, startDate: d(-30) }),
  ];

  const checkIns = (start: number, pains: number[], every: number, firstNote: string): InjuryCheckIn[] =>
    pains.map((pain, i) => ({
      id: uid(),
      date: d(-start + i * every),
      pain,
      mobility: Math.min(100, Math.round(55 + (7 - pain) * 7)),
      note: i === 0 ? firstNote : '',
    }));

  data.injuries = [
    newInjury({
      name: 'Patellar tendinopathy',
      bodyPart: 'Left knee',
      startedOn: d(-33),
      expectedWeeks: 8,
      status: 'recovering',
      notes: 'Physio: load the tendon gradually, pain up to 3/10 during exercise is OK if it settles by the next morning.',
      avoid: 'Deep squats, jumping, running downhill',
      rehabHabitIds: [SAMPLE_REHAB_HABIT_ID],
      checkIns: checkIns(32, [7, 7, 6, 6, 6, 5, 5, 4, 5, 4, 4, 3], 3, 'Sharp pain below the kneecap on stairs.').filter(
        (c) => c.date <= today,
      ),
    }),
    newInjury({
      name: 'Sprained ankle',
      bodyPart: 'Right ankle',
      startedOn: d(-210),
      expectedWeeks: 4,
      status: 'healed',
      healedOn: d(-178),
      checkIns: checkIns(210, [6, 4, 3, 2, 1, 0], 6, 'Rolled it on a trail run.'),
    }),
  ];
  data.nutrition = {
    ...data.nutrition,
    sex: 'male',
    birthDate: '1992-06-10',
    heightCm: 180.3,
    lifestyle: 'sedentary',
    workouts: [
      { id: uid(), name: 'Morning run', days: [1, 3, 5], minutes: 40, intensity: 'vigorous' },
      { id: uid(), name: 'Climbing', days: [6], minutes: 90, intensity: 'moderate' },
    ],
    goal: 'lose',
    ratePerWeek: 0.75,
    mealsPerDay: 3,
    otherCaloriesPerDay: 300,
  };
  data.recipes = sampleRecipes();
  const weekStart = startOfWeek(today, useStore.getState().settings.weekStartsOn);
  data.mealPlans = {
    [weekStart]: {
      weekStart,
      items: data.recipes.map((r) => ({ id: uid(), recipeId: r.id, batches: 1 })),
      checked: [],
    },
  };
  return data;
}
