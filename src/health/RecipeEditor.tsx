import { useState } from 'react';
import type { ID } from '../types';
import type { Ingredient, Macros, MealType, Recipe } from './types';
import { newIngredient, newRecipe, useHealth } from './store';
import { parseIngredientLine, recipeNutrition, UNIT_GRAMS, withFoodNutrition } from './nutrition';
import { foodPortions, searchFoods, toFoodRef, type FoodHit } from './usda';
import { Field, Icon, Modal, Segmented } from '../components/common';

export const MEAL_TYPES: { value: MealType; label: string }[] = [
  { value: 'any', label: 'Any meal' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

const num = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const show = (v: number | null, digits = 0) => (v === null ? '' : String(Math.round(v * 10 ** digits) / 10 ** digits));
const kcal = (v: number) => Math.round(v).toLocaleString();

export function RecipeEditor({ id, onClose }: { id: ID | null; onClose: () => void }) {
  const store = useHealth();
  const existing = id ? store.recipes.find((r) => r.id === id) : undefined;
  const [r, setR] = useState<Recipe>(() => (existing ? structuredClone(existing) : newRecipe()));
  const [lookupFor, setLookupFor] = useState<ID | null>(null);
  const [paste, setPaste] = useState('');
  const set = (p: Partial<Recipe>) => setR((prev) => ({ ...prev, ...p }));
  const setIngredient = (ingId: ID, p: Partial<Ingredient>) =>
    setR((prev) => ({ ...prev, ingredients: prev.ingredients.map((i) => (i.id === ingId ? withFoodNutrition({ ...i, ...p }) : i)) }));
  const nutrition = recipeNutrition({ ...r, manual: null });
  const lookupIngredient = r.ingredients.find((i) => i.id === lookupFor);

  const save = () => {
    store.saveRecipe({ ...r, name: r.name.trim() || 'Untitled recipe', ingredients: r.ingredients.filter((i) => i.name.trim() || i.calories !== null) });
    onClose();
  };

  const manual = r.manual;
  const setManual = (p: Partial<Macros>) => set({ manual: { ...(manual ?? { calories: 0, protein: 0, carbs: 0, fat: 0 }), ...p } });

  return (
    <Modal
      title={existing ? 'Edit recipe' : 'New recipe'}
      onClose={onClose}
      wide
      footer={
        <>
          {existing && (
            <button
              className="btn danger ghost"
              onClick={() => {
                if (confirm(`Delete “${existing.name}”? It will be removed from any meal plans.`)) {
                  store.deleteRecipe(existing.id);
                  onClose();
                }
              }}
            >
              <Icon name="trash" /> Delete
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            {existing ? 'Save' : 'Create recipe'}
          </button>
        </>
      }
    >
      <div className="stack">
        <input className="input title-input" autoFocus={!existing} placeholder="Recipe name" value={r.name} onChange={(e) => set({ name: e.target.value })} />
        <div className="row wrap">
          <Field label="Servings it makes">
            <input className="input" type="number" min={1} value={r.servings} onChange={(e) => set({ servings: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
          <Field label="Meal">
            <select className="input" value={r.mealType} onChange={(e) => set({ mealType: e.target.value as MealType })}>
              {MEAL_TYPES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prep + cook (min)">
            <input className="input" type="number" min={0} value={r.prepMinutes ?? ''} onChange={(e) => set({ prepMinutes: num(e.target.value) })} />
          </Field>
          <Field label="Keeps in the fridge (days)">
            <input className="input" type="number" min={0} value={r.keepsDays ?? ''} onChange={(e) => set({ keepsDays: num(e.target.value) })} />
          </Field>
        </div>

        <div className="field">
          <span className="field-label">Ingredients</span>
          <div className="table-wrap">
            <table className="table ingredient-table">
              <thead>
                <tr>
                  <th className="align-left">Ingredient</th>
                  <th className="num">Amount</th>
                  <th className="align-left">Unit</th>
                  <th className="num">kcal</th>
                  <th className="num">Protein g</th>
                  <th className="num">Carbs g</th>
                  <th className="num">Fat g</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.ingredients.map((i) => (
                  <IngredientRow
                    key={i.id}
                    ingredient={i}
                    lookingUp={lookupFor === i.id}
                    onChange={(p) => setIngredient(i.id, p)}
                    onLookup={() => setLookupFor(lookupFor === i.id ? null : i.id)}
                    onRemove={() => set({ ingredients: r.ingredients.filter((x) => x.id !== i.id) })}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="align-left">
                    Total{nutrition.unknown > 0 && <span className="muted"> · {nutrition.unknown} without calories</span>}
                  </td>
                  <td colSpan={2} />
                  <td className="num">{kcal(nutrition.total.calories)}</td>
                  <td className="num">{Math.round(nutrition.total.protein)}</td>
                  <td className="num">{Math.round(nutrition.total.carbs)}</td>
                  <td className="num">{Math.round(nutrition.total.fat)}</td>
                  <td />
                </tr>
                <tr>
                  <td className="align-left">Per serving</td>
                  <td colSpan={2} />
                  <td className="num">{kcal(nutrition.perServing.calories)}</td>
                  <td className="num">{Math.round(nutrition.perServing.protein)}</td>
                  <td className="num">{Math.round(nutrition.perServing.carbs)}</td>
                  <td className="num">{Math.round(nutrition.perServing.fat)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="row tight wrap">
            <button type="button" className="btn sm" onClick={() => set({ ingredients: [...r.ingredients, newIngredient()] })}>
              <Icon name="plus" size={14} /> Ingredient
            </button>
            <details className="paste-ingredients">
              <summary className="small">Paste an ingredient list</summary>
              <textarea className="input" rows={5} value={paste} placeholder={'2 lb chicken breast\n1 1/2 cups brown rice\n1 can black beans'} onChange={(e) => setPaste(e.target.value)} />
              <button
                type="button"
                className="btn sm"
                disabled={!paste.trim()}
                onClick={() => {
                  const added = paste
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .map((l) => newIngredient(parseIngredientLine(l)));
                  set({ ingredients: [...r.ingredients, ...added] });
                  setPaste('');
                }}
              >
                Add these lines
              </button>
            </details>
          </div>
          {lookupIngredient && (
            <FoodLookup
              ingredient={lookupIngredient}
              apiKey={store.nutrition.fdcApiKey}
              onPick={(p) => {
                setIngredient(lookupIngredient.id, p);
                setLookupFor(null);
              }}
              onClose={() => setLookupFor(null)}
            />
          )}
        </div>

        <Field label="Nutrition per serving">
          <Segmented
            value={manual ? 'manual' : 'ingredients'}
            onChange={(v) => set({ manual: v === 'manual' ? { ...nutrition.perServing } : null })}
            options={[
              { value: 'ingredients', label: 'Add up the ingredients' },
              { value: 'manual', label: 'Enter it myself' },
            ]}
          />
        </Field>
        {manual && (
          <div className="row wrap">
            {(['calories', 'protein', 'carbs', 'fat'] as const).map((k) => (
              <Field key={k} label={k === 'calories' ? 'kcal' : `${k[0].toUpperCase()}${k.slice(1)} (g)`}>
                <input className="input" type="number" min={0} value={show(manual[k])} onChange={(e) => setManual({ [k]: num(e.target.value) ?? 0 })} />
              </Field>
            ))}
          </div>
        )}

        <Field label="Instructions">
          <textarea className="input" rows={5} value={r.instructions} onChange={(e) => set({ instructions: e.target.value })} />
        </Field>
        <div className="row wrap">
          <Field label="Source link">
            <input className="input" placeholder="https://" value={r.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} />
          </Field>
          <Field label="Notes">
            <input className="input" placeholder="Swaps, freezing tips…" value={r.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function IngredientRow({
  ingredient: i,
  lookingUp,
  onChange,
  onLookup,
  onRemove,
}: {
  ingredient: Ingredient;
  lookingUp: boolean;
  onChange: (p: Partial<Ingredient>) => void;
  onLookup: () => void;
  onRemove: () => void;
}) {
  const linked = !!i.food;
  const unitOptions = i.food ? [...Object.keys(UNIT_GRAMS).map((u) => ({ label: u, grams: UNIT_GRAMS[u] })), ...i.food.portions] : [];
  const macroCell = (k: 'calories' | 'protein' | 'carbs' | 'fat') => (
    <td className="num">
      {linked ? (
        <span className="macro-readonly">{show(i[k], k === 'calories' ? 0 : 1) || '–'}</span>
      ) : (
        <input className="input sm num-input" type="number" min={0} value={show(i[k], 1)} onChange={(e) => onChange({ [k]: num(e.target.value) })} aria-label={k} />
      )}
    </td>
  );
  return (
    <tr className={lookingUp ? 'is-selected' : ''}>
      <td className="align-left">
        <input className="input sm" value={i.name} placeholder="e.g. brown rice" onChange={(e) => onChange({ name: e.target.value })} aria-label="Ingredient" />
        {i.food && (
          <div className="cell-sub" title={i.food.description}>
            USDA: {i.food.description}
          </div>
        )}
      </td>
      <td className="num">
        <input className="input sm num-input" type="number" min={0} step="any" value={show(i.quantity, 2)} onChange={(e) => onChange({ quantity: num(e.target.value) })} aria-label="Amount" />
      </td>
      <td className="align-left">
        {i.food ? (
          <select
            className="input sm"
            value={i.unit}
            aria-label="Unit"
            onChange={(e) => {
              const opt = unitOptions.find((o) => o.label === e.target.value);
              if (opt && i.food) onChange({ unit: opt.label, food: { ...i.food, gramsPerUnit: opt.grams } });
            }}
          >
            {unitOptions.map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
                {!(o.label in UNIT_GRAMS) ? ` (${Math.round(o.grams)} g)` : ''}
              </option>
            ))}
          </select>
        ) : (
          <input className="input sm unit-input" value={i.unit} placeholder="cup" onChange={(e) => onChange({ unit: e.target.value })} aria-label="Unit" />
        )}
      </td>
      {macroCell('calories')}
      {macroCell('protein')}
      {macroCell('carbs')}
      {macroCell('fat')}
      <td className="row-actions">
        {linked ? (
          <button type="button" className="btn icon ghost sm" title="Unlink from USDA and edit by hand" aria-label="Unlink food" onClick={() => onChange({ food: null })}>
            <Icon name="x" size={14} />
          </button>
        ) : (
          <button type="button" className={`btn icon ghost sm${lookingUp ? ' is-on' : ''}`} title="Look up nutrition (USDA)" aria-label="Look up nutrition" onClick={onLookup}>
            <Icon name="search" size={14} />
          </button>
        )}
        <button type="button" className="btn icon ghost sm" aria-label="Remove ingredient" onClick={onRemove}>
          <Icon name="trash" size={14} />
        </button>
      </td>
    </tr>
  );
}

function FoodLookup({
  ingredient,
  apiKey,
  onPick,
  onClose,
}: {
  ingredient: Ingredient;
  apiKey: string;
  onPick: (p: Partial<Ingredient>) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(ingredient.name);
  const [hits, setHits] = useState<FoodHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setHits(await searchFoods(query.trim(), apiKey));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const pick = async (hit: FoodHit) => {
    setBusy(true);
    const portions = hit.dataType === 'Branded' ? [] : await foodPortions(hit.fdcId, apiKey);
    const food = toFoodRef(hit, portions);
    // Keep the typed unit when USDA knows it (lb, cup…); otherwise switch to grams.
    const wanted = ingredient.unit.toLowerCase();
    const match = wanted in UNIT_GRAMS ? { label: wanted, grams: UNIT_GRAMS[wanted] } : food.portions.find((p) => p.label.toLowerCase().startsWith(wanted) && wanted);
    const unit = match ?? { label: 'g', grams: 1 };
    onPick({
      name: ingredient.name || hit.description,
      unit: unit.label,
      quantity: match ? ingredient.quantity : ingredient.quantity === null ? 100 : null,
      food: { ...food, gramsPerUnit: unit.grams },
    });
    setBusy(false);
  };

  return (
    <div className="food-lookup">
      <form
        className="row tight"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input className="input grow" autoFocus value={query} placeholder="Search USDA foods, e.g. chicken breast raw" onChange={(e) => setQuery(e.target.value)} />
        <button className="btn primary sm" type="submit" disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </button>
        <button className="btn ghost sm" type="button" onClick={onClose}>
          Close
        </button>
      </form>
      {error && <div className="notice is-error">{error}</div>}
      {hits && hits.length === 0 && <p className="small muted">No matches. Try fewer words, like “rice brown cooked”.</p>}
      {hits && hits.length > 0 && (
        <ul className="food-hits">
          {hits.map((h) => (
            <li key={h.fdcId}>
              <button type="button" onClick={() => pick(h)} disabled={busy}>
                <span className="food-hit-name">
                  {h.description}
                  {h.brand && <span className="muted"> · {h.brand}</span>}
                </span>
                <span className="small muted">
                  {Math.round(h.per100g.calories)} kcal · {Math.round(h.per100g.protein)} g protein per 100 g · {h.dataType}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">
        Tip: “raw” vs “cooked” changes calories a lot, so match how you measure. If USDA doesn't know your unit, the amount switches to grams for you to fill in.
      </p>
    </div>
  );
}
