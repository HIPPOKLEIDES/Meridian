import { useMemo, useState } from 'react';
import type { ID } from '../types';
import type { NutritionProfile, Recipe, Workout } from './types';
import { useHealth } from './store';
import {
  currentWeight,
  formatQuantity,
  INTENSITIES,
  LB_PER_KG,
  LIFESTYLES,
  planCoverage,
  recipeNutrition,
  shoppingList,
  weeklyNeeds,
} from './nutrition';
import { forecastGoal } from './projection';
import { useHealthArea, useHealthColor } from './describe';
import { MEAL_TYPES, RecipeEditor } from './RecipeEditor';
import { useStore, uid } from '../store';
import { useUI } from '../ui';
import { CheckButton, Empty, Field, Icon, Progress, Segmented } from '../components/common';
import { DateInput, DayPicker } from '../components/inputs';
import { ColumnChart } from '../components/TrendChart';
import { addDays, fmtDateShort, fmtDays, startOfWeek, todayKey, WEEKDAY_SHORT } from '../lib/dates';
import { navigate } from '../lib/hooks';

type Sub = 'week' | 'recipes' | 'needs';

const kcal = (v: number) => `${Math.round(v).toLocaleString()} kcal`;
const grams = (v: number) => `${Math.round(v).toLocaleString()} g`;

/** Shared inputs for every panel: the profile, weight and the week's targets. */
function useNeeds() {
  const nutrition = useHealth((s) => s.nutrition);
  const metrics = useHealth((s) => s.metrics);
  const measurements = useHealth((s) => s.measurements);
  const today = todayKey();
  const weight = currentWeight(nutrition, metrics, measurements);
  const needs = useMemo(() => weeklyNeeds(nutrition, weight.kg, today, weight.imperial), [nutrition, weight.kg, today, weight.imperial]);
  return { nutrition, weight, needs, today };
}

export function NutritionTab({ sub }: { sub?: string }) {
  const current: Sub = sub === 'recipes' || sub === 'needs' ? sub : 'week';
  return (
    <>
      <div className="toolbar">
        <Segmented<Sub>
          value={current}
          onChange={(v) => navigate(`health/nutrition/${v}`)}
          options={[
            { value: 'week', label: 'This week' },
            { value: 'recipes', label: 'Recipes' },
            { value: 'needs', label: 'Calorie needs' },
          ]}
        />
      </div>
      {current === 'week' && <WeekPanel />}
      {current === 'recipes' && <RecipesPanel />}
      {current === 'needs' && <NeedsPanel />}
    </>
  );
}

/* ───────── This week ───────── */

function WeekPanel() {
  const { nutrition, needs, today } = useNeeds();
  const recipes = useHealth((s) => s.recipes);
  const mealPlans = useHealth((s) => s.mealPlans);
  const updateMealPlan = useHealth((s) => s.updateMealPlan);
  const updateNutrition = useHealth((s) => s.updateNutrition);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const toast = useUI((s) => s.toast);
  const color = useHealthColor();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today, weekStartsOn));
  const [editing, setEditing] = useState<{ id: ID | null } | null>(null);
  const plan = mealPlans[weekStart];
  const coverage = planCoverage(plan, recipes, nutrition, needs);
  const list = shoppingList(plan, recipes);
  const ready = needs.missing.length === 0;
  const coveredDays = nutrition.prepDays.length;

  const planned = (plan?.items ?? []).map((item) => ({ item, recipe: recipes.find((r) => r.id === item.recipeId) })).filter((x): x is { item: typeof x.item; recipe: Recipe } => !!x.recipe);
  const available = recipes.filter((r) => !planned.some((p) => p.recipe.id === r.id));
  // Suggest the planned recipe whose servings best fill the gap.
  const gapRecipe = planned.length ? planned.reduce((best, p) => (recipeNutrition(p.recipe).perServing.calories > recipeNutrition(best.recipe).perServing.calories ? p : best)).recipe : null;
  const gapServings = gapRecipe ? Math.abs(coverage.shortfall) / Math.max(1, recipeNutrition(gapRecipe).perServing.calories) : 0;

  const setBatches = (itemId: ID, batches: number) =>
    updateMealPlan(weekStart, (p) => ({ ...p, items: batches <= 0 ? p.items.filter((i) => i.id !== itemId) : p.items.map((i) => (i.id === itemId ? { ...i, batches } : i)) }));

  const copyList = async () => {
    const text = list.map((l) => `${formatQuantity(l.quantity, l.unit)} ${l.name}`.trim()).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Shopping list copied');
    } catch {
      toast('Copying was blocked by the browser');
    }
  };

  return (
    <>
      <div className="toolbar">
        <div className="date-nav">
          <button className="btn icon" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <Icon name="left" />
          </button>
          <b>
            Week of {fmtDateShort(weekStart)} – {fmtDateShort(addDays(weekStart, 6))}
          </b>
          <button className="btn icon" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <Icon name="right" />
          </button>
        </div>
        {weekStart !== startOfWeek(today, weekStartsOn) && (
          <button className="btn sm ghost" onClick={() => setWeekStart(startOfWeek(today, weekStartsOn))}>
            This week
          </button>
        )}
      </div>

      {!ready ? (
        <div className="banner">
          <div>
            Add your {needs.missing.join(', ')} under <b>Calorie needs</b> to see how much to make this week.
          </div>
          <button className="btn primary" onClick={() => navigate('health/nutrition/needs')}>
            Set up calorie needs
          </button>
        </div>
      ) : (
        <div className="stat-row">
          <div className="card stat">
            <span className="stat-label">Calories this week</span>
            <span className="stat-value">{Math.round(needs.weekTarget).toLocaleString()}</span>
            <span className="stat-foot">about {kcal(needs.weekTarget / 7)} a day</span>
          </div>
          <div className="card stat">
            <span className="stat-label">To make on prep day</span>
            <span className="stat-value">{Math.round(coverage.prepTarget).toLocaleString()}</span>
            <span className="stat-foot">
              kcal after {kcal(nutrition.otherCaloriesPerDay)}/day of other food
            </span>
          </div>
          <div className="card stat">
            <span className="stat-label">Servings to make</span>
            <span className="stat-value">{coverage.servingsNeeded}</span>
            <span className="stat-foot">
              {nutrition.mealsPerDay} a day × {coveredDays} day{coveredDays === 1 ? '' : 's'} · ~{kcal(coverage.perServingTarget)} each
            </span>
          </div>
          <div className="card stat">
            <span className="stat-label">Protein from prep</span>
            <span className="stat-value">{Math.round(coverage.proteinTarget).toLocaleString()} g</span>
            <span className="stat-foot">of {grams(needs.protein * 7)} for the week</span>
          </div>
        </div>
      )}

      <div className="two-col">
        <section className="card stack">
          <header className="card-head">
            <h3 className="card-title">What you're making</h3>
            <button className="btn sm" onClick={() => setEditing({ id: null })}>
              <Icon name="plus" size={14} /> New recipe
            </button>
          </header>
          {planned.length === 0 && <Empty>{recipes.length ? 'Add recipes to this week’s prep below.' : 'Save a few recipes first, then plan the week here.'}</Empty>}
          {planned.map(({ item, recipe }) => {
            const n = recipeNutrition(recipe);
            const short = recipe.keepsDays !== null && recipe.keepsDays < coveredDays;
            return (
              <div key={item.id} className="plan-row">
                <div className="plan-row-text">
                  <button className="link-plain" onClick={() => setEditing({ id: recipe.id })}>
                    {recipe.name}
                  </button>
                  <span className="small muted">
                    {kcal(n.perServing.calories)} · {Math.round(n.perServing.protein)} g protein per serving
                    {n.unknown > 0 && ` · ${n.unknown} ingredient${n.unknown === 1 ? '' : 's'} without calories`}
                  </span>
                  {short && <span className="small is-warn-text">Keeps {recipe.keepsDays} days, so freeze some or split the cooking.</span>}
                </div>
                <div className="stepper" aria-label={`Batches of ${recipe.name}`}>
                  <button className="btn icon sm" aria-label="Fewer batches" onClick={() => setBatches(item.id, item.batches - 0.5)}>
                    −
                  </button>
                  <span>{item.batches}×</span>
                  <button className="btn icon sm" aria-label="More batches" onClick={() => setBatches(item.id, item.batches + 0.5)}>
                    +
                  </button>
                </div>
                <div className="plan-row-total">
                  <b>{Math.round(recipe.servings * item.batches * 10) / 10} servings</b>
                  <span className="small muted">{kcal(n.total.calories * item.batches)}</span>
                </div>
              </div>
            );
          })}
          {available.length > 0 && (
            <select
              className="input"
              value=""
              onChange={(e) => {
                const recipeId = e.target.value;
                if (recipeId) updateMealPlan(weekStart, (p) => ({ ...p, items: [...p.items, { id: uid(), recipeId, batches: 1 }] }));
              }}
            >
              <option value="">+ Add a recipe to this week…</option>
              {available.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({kcal(recipeNutrition(r).perServing.calories)}/serving)
                </option>
              ))}
            </select>
          )}
        </section>

        <section className="card stack">
          <h3 className="card-title">Does it cover the week?</h3>
          {!ready ? (
            <Empty>Set up calorie needs to compare.</Empty>
          ) : (
            <>
              <CoverageMeter label="Calories" made={coverage.made.calories} need={coverage.prepTarget} format={kcal} color={color} />
              <CoverageMeter label="Servings" made={coverage.servingsMade} need={coverage.servingsNeeded} format={(v) => `${Math.round(v * 10) / 10}`} color={color} />
              <CoverageMeter label="Protein" made={coverage.made.protein} need={coverage.proteinTarget} format={grams} color={color} />
              {planned.length > 0 && (
                <div className={`forecast ${Math.abs(coverage.shortfall) < coverage.prepTarget * 0.05 ? 'tone-good' : 'tone-warn'}`}>
                  {Math.abs(coverage.shortfall) < coverage.prepTarget * 0.05 ? (
                    <>
                      <b>That's about right</b>
                      <span>Within 5% of what the week needs.</span>
                    </>
                  ) : coverage.shortfall > 0 ? (
                    <>
                      <b>About {kcal(coverage.shortfall)} short</b>
                      <span>
                        That's roughly {Math.ceil(gapServings)} more serving{Math.ceil(gapServings) === 1 ? '' : 's'} of {gapRecipe?.name}, or add another recipe.
                      </span>
                    </>
                  ) : (
                    <>
                      <b>About {kcal(-coverage.shortfall)} more than needed</b>
                      <span>
                        Roughly {Math.floor(gapServings)} serving{Math.floor(gapServings) === 1 ? '' : 's'} of {gapRecipe?.name} extra. Fine if some meals go in the freezer.
                      </span>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          <details className="prep-settings">
            <summary className="small">
              Prep covers {fmtDays(nutrition.prepDays).toLowerCase()} · {nutrition.mealsPerDay} meal{nutrition.mealsPerDay === 1 ? '' : 's'} a day · {kcal(nutrition.otherCaloriesPerDay)}/day other food
            </summary>
            <div className="stack tight">
              <Field label="Days the prepped food covers">
                <DayPicker days={nutrition.prepDays} onChange={(prepDays) => updateNutrition({ prepDays })} />
              </Field>
              <div className="row wrap">
                <Field label="Prepped meals per day">
                  <input className="input" type="number" min={1} max={6} value={nutrition.mealsPerDay} onChange={(e) => updateNutrition({ mealsPerDay: Math.max(1, Number(e.target.value) || 1) })} />
                </Field>
                <Field label="Other food per day (kcal)" hint="Snacks, drinks, meals out">
                  <input className="input" type="number" min={0} step={50} value={nutrition.otherCaloriesPerDay} onChange={(e) => updateNutrition({ otherCaloriesPerDay: Math.max(0, Number(e.target.value) || 0) })} />
                </Field>
              </div>
            </div>
          </details>
        </section>
      </div>

      <section className="card stack">
        <header className="card-head">
          <h3 className="card-title">Shopping list</h3>
          <div className="row tight">
            {plan && plan.checked.length > 0 && (
              <button className="btn sm ghost" onClick={() => updateMealPlan(weekStart, (p) => ({ ...p, checked: [] }))}>
                Uncheck all
              </button>
            )}
            <button className="btn sm" onClick={copyList} disabled={list.length === 0}>
              <Icon name="copy" size={14} /> Copy
            </button>
          </div>
        </header>
        {list.length === 0 ? (
          <Empty>Ingredients from this week's recipes show up here, combined and scaled by batches.</Empty>
        ) : (
          <ul className="shopping-list">
            {list.map((l) => {
              const checked = !!plan?.checked.includes(l.key);
              return (
                <li key={l.key} className={checked ? 'is-done' : ''}>
                  <CheckButton
                    size="sm"
                    checked={checked}
                    onToggle={() =>
                      updateMealPlan(weekStart, (p) => ({ ...p, checked: checked ? p.checked.filter((k) => k !== l.key) : [...p.checked, l.key] }))
                    }
                  />
                  <span className="shopping-qty">{formatQuantity(l.quantity, l.unit)}</span>
                  <span className="shopping-name">{l.name}</span>
                  <span className="small muted shopping-for">{l.recipes.join(', ')}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {editing && <RecipeEditor id={editing.id} onClose={() => setEditing(null)} />}
    </>
  );
}

function CoverageMeter({ label, made, need, format, color }: { label: string; made: number; need: number; format: (v: number) => string; color: string }) {
  const ratio = need > 0 ? made / need : 0;
  return (
    <div className="coverage">
      <div className="coverage-head">
        <span>{label}</span>
        <span className="small">
          <b>{format(made)}</b> <span className="muted">of {format(need)}</span>
        </span>
      </div>
      <span className="meter" style={{ ['--meter-color' as string]: color }}>
        <Progress value={ratio} label={`${label} covered`} />
      </span>
    </div>
  );
}

/* ───────── Recipes ───────── */

function RecipesPanel() {
  const recipes = useHealth((s) => s.recipes);
  const updateMealPlan = useHealth((s) => s.updateMealPlan);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const toast = useUI((s) => s.toast);
  const [editing, setEditing] = useState<{ id: ID | null } | null>(null);
  const [query, setQuery] = useState('');
  const [meal, setMeal] = useState<string>('all');
  const weekStart = startOfWeek(todayKey(), weekStartsOn);
  const plan = useHealth((s) => s.mealPlans[weekStart]);

  const shown = recipes
    .filter((r) => meal === 'all' || r.mealType === meal)
    .filter((r) => {
      const q = query.trim().toLowerCase();
      return !q || r.name.toLowerCase().includes(q) || r.ingredients.some((i) => i.name.toLowerCase().includes(q));
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setEditing({ id: null })}>
          <Icon name="plus" /> New recipe
        </button>
        <input className="input search" placeholder="Search recipes or ingredients…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Segmented value={meal} onChange={setMeal} options={[{ value: 'all', label: 'All' }, ...MEAL_TYPES.filter((m) => m.value !== 'any').map((m) => ({ value: m.value as string, label: m.label }))]} />
      </div>
      {shown.length === 0 ? (
        <section className="card">
          <Empty>{recipes.length ? 'No recipes match.' : 'No recipes yet. Add the meals you prep most often.'}</Empty>
        </section>
      ) : (
        <div className="project-grid">
          {shown.map((r) => {
            const n = recipeNutrition(r);
            const inPlan = !!plan?.items.some((i) => i.recipeId === r.id);
            return (
              <div key={r.id} className="card recipe-card">
                <button className="recipe-card-main" onClick={() => setEditing({ id: r.id })}>
                  <div className="project-card-head">
                    <h3>{r.name}</h3>
                    {r.mealType !== 'any' && <span className="badge">{r.mealType}</span>}
                  </div>
                  <div className="recipe-macros">
                    <div>
                      <b>{Math.round(n.perServing.calories)}</b>
                      <span>kcal</span>
                    </div>
                    <div>
                      <b>{Math.round(n.perServing.protein)}g</b>
                      <span>protein</span>
                    </div>
                    <div>
                      <b>{Math.round(n.perServing.carbs)}g</b>
                      <span>carbs</span>
                    </div>
                    <div>
                      <b>{Math.round(n.perServing.fat)}g</b>
                      <span>fat</span>
                    </div>
                  </div>
                  <div className="small muted">
                    per serving · makes {r.servings}
                    {r.prepMinutes ? ` · ${r.prepMinutes} min` : ''}
                    {r.keepsDays ? ` · keeps ${r.keepsDays} days` : ''}
                    {n.source === 'none' && ' · no nutrition yet'}
                  </div>
                </button>
                <button
                  className="btn sm"
                  disabled={inPlan}
                  onClick={() => {
                    updateMealPlan(weekStart, (p) => ({ ...p, items: [...p.items, { id: uid(), recipeId: r.id, batches: 1 }] }));
                    toast(`Added ${r.name} to this week`);
                  }}
                >
                  {inPlan ? (
                    <>
                      <Icon name="check" size={14} /> In this week's prep
                    </>
                  ) : (
                    <>
                      <Icon name="plus" size={14} /> Add to this week
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {editing && <RecipeEditor id={editing.id} onClose={() => setEditing(null)} />}
    </>
  );
}

/* ───────── Calorie needs ───────── */

function NeedsPanel() {
  const { nutrition: p, weight, needs, today } = useNeeds();
  const update = useHealth((s) => s.updateNutrition);
  const goals = useHealth((s) => s.goals);
  const metrics = useHealth((s) => s.metrics);
  const measurements = useHealth((s) => s.measurements);
  const habits = useStore((s) => s.habits);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const healthArea = useHealthArea();
  const color = useHealthColor();
  const unit = weight.imperial ? 'lb' : 'kg';
  const weekOrder = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);

  const weightMetric = metrics.find((m) => m.source === 'weight') ?? metrics.find((m) => /weight/i.test(m.name));
  const weightGoal = weightMetric ? goals.find((g) => !g.archived && g.kind === 'reach' && g.metricId === weightMetric.id) : undefined;
  const goalRate = weightGoal && weightMetric ? forecastGoal(weightGoal, weightMetric, measurements, today).requiredPerWeek : null;

  const setWorkout = (id: ID, patch: Partial<Workout>) => update({ workouts: p.workouts.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const habitCandidates = habits.filter((h) => !h.archived && (!healthArea || h.areaId === healthArea.id) && !p.workouts.some((w) => w.name === h.title));

  return (
    <div className="two-col">
      <section className="card stack">
        <h3 className="card-title">About you</h3>
        <div className="row wrap">
          <Field label="Sex" hint="Used by the BMR formula.">
            <Segmented
              value={p.sex ?? ''}
              onChange={(sex) => update({ sex: sex === '' ? null : (sex as NutritionProfile['sex']) })}
              options={[
                { value: 'male', label: 'Male' },
                { value: 'female', label: 'Female' },
              ]}
            />
          </Field>
          <Field label="Birth date">
            <DateInput value={p.birthDate} onChange={(birthDate) => update({ birthDate })} />
          </Field>
        </div>
        <div className="row wrap">
          <HeightInput cm={p.heightCm} imperial={weight.imperial} onChange={(heightCm) => update({ heightCm })} />
          {weight.fromReading ? (
            <Field label="Weight">
              <div className="readonly-value">
                {Math.round((weight.imperial ? weight.kg! * LB_PER_KG : weight.kg!) * 10) / 10} {unit}
                <span className="small muted"> · latest reading{weight.date ? `, ${fmtDateShort(weight.date)}` : ''}</span>
              </div>
            </Field>
          ) : (
            <Field label={`Weight (${unit})`} hint="Or log it under Measurements.">
              <input
                className="input"
                type="number"
                min={0}
                step={0.1}
                value={p.weightKg ? Math.round((weight.imperial ? p.weightKg * LB_PER_KG : p.weightKg) * 10) / 10 : ''}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  update({ weightKg: v > 0 ? (weight.imperial ? v / LB_PER_KG : v) : null });
                }}
              />
            </Field>
          )}
        </div>

        <Field label="Everyday activity (not counting workouts)">
          <div className="choice-list">
            {LIFESTYLES.map((l) => (
              <button key={l.id} type="button" className={`choice${p.lifestyle === l.id ? ' is-on' : ''}`} onClick={() => update({ lifestyle: l.id })}>
                <b>{l.label}</b>
                <span className="small muted">{l.hint}</span>
              </button>
            ))}
          </div>
        </Field>

        <div className="field">
          <span className="field-label">Weekly workouts</span>
          {p.workouts.length === 0 && <p className="small muted">Add regular workouts so those days get more calories.</p>}
          {p.workouts.map((w) => (
            <div key={w.id} className="workout-row">
              <input className="input" value={w.name} aria-label="Workout name" onChange={(e) => setWorkout(w.id, { name: e.target.value })} />
              <DayPicker days={w.days} onChange={(days) => setWorkout(w.id, { days })} />
              <label className="inline-label">
                <input className="input num" type="number" min={0} step={5} value={w.minutes} onChange={(e) => setWorkout(w.id, { minutes: Math.max(0, Number(e.target.value) || 0) })} />
                min
              </label>
              <select className="input" value={w.intensity} aria-label="Intensity" onChange={(e) => setWorkout(w.id, { intensity: e.target.value as Workout['intensity'] })}>
                {INTENSITIES.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label} ({i.examples})
                  </option>
                ))}
              </select>
              <button className="btn icon ghost" aria-label={`Remove ${w.name}`} onClick={() => update({ workouts: p.workouts.filter((x) => x.id !== w.id) })}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
          <div className="row tight wrap">
            <button className="btn sm" onClick={() => update({ workouts: [...p.workouts, { id: uid(), name: 'Workout', days: [1, 3, 5], minutes: 45, intensity: 'moderate' }] })}>
              <Icon name="plus" size={14} /> Workout
            </button>
            {habitCandidates.length > 0 && (
              <select
                className="input sm"
                value=""
                onChange={(e) => {
                  const h = habits.find((x) => x.id === e.target.value);
                  if (h) update({ workouts: [...p.workouts, { id: uid(), name: h.title, days: [...h.days], minutes: h.duration, intensity: 'moderate' }] });
                }}
              >
                <option value="">+ From a health habit…</option>
                {habitCandidates.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.title} ({fmtDays(h.days)}, {h.duration} min)
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <Field label="Goal">
          <Segmented
            value={p.goal}
            onChange={(goal) => update({ goal })}
            options={[
              { value: 'lose', label: 'Lose weight' },
              { value: 'maintain', label: 'Maintain' },
              { value: 'gain', label: 'Gain' },
            ]}
          />
        </Field>
        {p.goal !== 'maintain' && (
          <div className="row wrap">
            <Field label={`Rate (${unit} per week)`}>
              <input className="input" type="number" min={0} step={0.1} value={p.ratePerWeek} onChange={(e) => update({ ratePerWeek: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
            {weightGoal && goalRate !== null && (
              <div className="goal-hint small">
                Your goal of {weightGoal.target} {unit}
                {weightGoal.deadline ? ` by ${fmtDateShort(weightGoal.deadline)}` : ''} needs about {Math.abs(goalRate).toFixed(2)} {unit}/week.{' '}
                <button className="link" onClick={() => update({ ratePerWeek: Math.round(Math.abs(goalRate) * 100) / 100, goal: goalRate < 0 ? 'lose' : 'gain' })}>
                  Use that
                </button>
              </div>
            )}
          </div>
        )}
        <div className="row wrap">
          <Field label={`Protein (g per ${unit} of body weight)`} hint={weight.imperial ? '0.7–1.0 g/lb is common for active people.' : '1.6–2.2 g/kg is common for active people.'}>
            <input
              className="input"
              type="number"
              min={0}
              step={0.05}
              value={Math.round((weight.imperial ? p.proteinPerKg / LB_PER_KG : p.proteinPerKg) * 100) / 100}
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0);
                update({ proteinPerKg: weight.imperial ? v * LB_PER_KG : v });
              }}
            />
          </Field>
          <Field label="Fat (% of calories)">
            <input className="input" type="number" min={10} max={60} value={p.fatPct} onChange={(e) => update({ fatPct: Math.max(0, Math.min(80, Number(e.target.value) || 0)) })} />
          </Field>
        </div>

        <details>
          <summary className="small">Food lookup (USDA) API key</summary>
          <div className="stack tight">
            <p className="small muted">
              Ingredient lookups use USDA FoodData Central. Without a key they share a demo key limited to about 30 searches an hour. A free personal key
              allows 1,000 an hour: <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noreferrer">sign up here</a>, then paste it below. It stays in this
              browser and isn't included in backups.
            </p>
            <input className="input" type="password" autoComplete="off" placeholder="api.data.gov key (optional)" value={p.fdcApiKey} onChange={(e) => update({ fdcApiKey: e.target.value.trim() })} />
          </div>
        </details>
      </section>

      <section className="card stack">
        <h3 className="card-title">Your numbers</h3>
        {needs.missing.length > 0 ? (
          <Empty>Add your {needs.missing.join(', ')} to calculate.</Empty>
        ) : (
          <>
            <div className="needs-hero">
              <div>
                <span className="stat-label">Per week</span>
                <span className="hero-value">{Math.round(needs.weekTarget).toLocaleString()}</span>
                <span className="small muted">kcal</span>
              </div>
              <div>
                <span className="stat-label">Per day, on average</span>
                <span className="hero-value">{Math.round(needs.weekTarget / 7).toLocaleString()}</span>
                <span className="small muted">kcal</span>
              </div>
            </div>
            <dl className="calc">
              <div className="calc-line">
                <dt>Basal metabolic rate</dt>
                <dd>{kcal(needs.bmr)}</dd>
              </div>
              <div className="calc-line">
                <dt>With everyday activity</dt>
                <dd>{kcal(needs.baseline)}</dd>
              </div>
              <div className="calc-line">
                <dt>Maintenance for the week (incl. workouts)</dt>
                <dd>{kcal(needs.weekMaintenance)}</dd>
              </div>
              {needs.goalAdjustment !== 0 && (
                <div className="calc-line">
                  <dt>
                    Goal: {p.goal} {p.ratePerWeek} {unit}/week
                    <span className="calc-note">Based on ~3,500 kcal per lb; progress usually slows over time, so recheck against your weight trend.</span>
                  </dt>
                  <dd>
                    {needs.goalAdjustment > 0 ? '+' : '−'}
                    {kcal(Math.abs(needs.goalAdjustment))}/day
                  </dd>
                </div>
              )}
              <div className="calc-line is-strong">
                <dt>Daily protein · fat · avg carbs</dt>
                <dd>
                  {grams(needs.protein)} · {grams(needs.fat)} · {grams(needs.carbsAvg)}
                </dd>
              </div>
            </dl>
            {needs.warnings.map((w) => (
              <div key={w} className="notice is-error">
                {w}
              </div>
            ))}
            <ColumnChart
              height={170}
              groups={weekOrder.map((wd) => needs.days[wd]).map((d) => ({
                key: String(d.weekday),
                label: WEEKDAY_SHORT[d.weekday],
                title: `${WEEKDAY_SHORT[d.weekday]}${d.workouts.length ? ` · ${d.workouts.map((w) => w.name).join(', ')}` : ''}`,
                values: [d.target],
              }))}
              series={[{ name: 'Target', color }]}
              format={kcal}
              axisFormat={(v) => `${Math.round(v / 100) / 10}k`}
            />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th className="align-left">Workouts</th>
                    <th className="num">Maintenance</th>
                    <th className="num">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {weekOrder.map((wd) => {
                    const d = needs.days[wd];
                    return (
                      <tr key={wd}>
                        <td>{WEEKDAY_SHORT[wd]}</td>
                        <td className="align-left">{d.workouts.length ? d.workouts.map((w) => `${w.name} (+${Math.round(w.calories)})`).join(', ') : <span className="muted">Rest</span>}</td>
                        <td className="num">{Math.round(d.maintenance).toLocaleString()}</td>
                        <td className="num">
                          <b>{Math.round(d.target).toLocaleString()}</b>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Week</td>
                    <td />
                    <td className="num">{Math.round(needs.weekMaintenance).toLocaleString()}</td>
                    <td className="num">{Math.round(needs.weekTarget).toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="small muted">
              Estimates from the Mifflin-St Jeor equation plus workout calories (MET-based). Everyone varies by a few hundred calories a day, so
              treat this as a starting point and adjust after 2–3 weeks based on your weight trend. Not medical advice.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function HeightInput({ cm, imperial, onChange }: { cm: number | null; imperial: boolean; onChange: (cm: number | null) => void }) {
  if (!imperial) {
    return (
      <Field label="Height (cm)">
        <input className="input" type="number" min={0} value={cm ?? ''} onChange={(e) => onChange(Number(e.target.value) > 0 ? Number(e.target.value) : null)} />
      </Field>
    );
  }
  const totalIn = cm ? cm / 2.54 : 0;
  const ft = cm ? Math.floor(totalIn / 12) : '';
  const inches = cm ? Math.round(totalIn - Math.floor(totalIn / 12) * 12) : '';
  const set = (f: number, i: number) => onChange(f * 12 + i > 0 ? (f * 12 + i) * 2.54 : null);
  return (
    <Field label="Height">
      <div className="row tight">
        <label className="inline-label">
          <input className="input num" type="number" min={0} max={8} value={ft} onChange={(e) => set(Number(e.target.value) || 0, Number(inches) || 0)} />
          ft
        </label>
        <label className="inline-label">
          <input className="input num" type="number" min={0} max={11} value={inches} onChange={(e) => set(Number(ft) || 0, Number(e.target.value) || 0)} />
          in
        </label>
      </div>
    </Field>
  );
}
