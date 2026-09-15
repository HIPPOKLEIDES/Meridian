/**
 * USDA FoodData Central search (https://fdc.nal.usda.gov/api-guide/). Works directly from the browser.
 * Without a personal api.data.gov key the shared DEMO_KEY allows about 30 requests an hour per IP.
 */
import type { FoodRef, Macros } from './types';

const API = 'https://api.nal.usda.gov/fdc/v1';

/** Loosely typed API payloads, read defensively. */
type Json = any;

export interface FoodHit {
  fdcId: number;
  description: string;
  dataType: string;
  brand: string | null;
  per100g: Macros;
  /** Branded foods list a label serving, e.g. 28 g. */
  serving: { label: string; grams: number } | null;
}

const keyParam = (apiKey: string) => encodeURIComponent(apiKey.trim() || 'DEMO_KEY');

async function get(url: string): Promise<Json> {
  const res = await fetch(url);
  if (res.status === 429) throw new Error('USDA rate limit reached. Add your own free API key in Calorie needs → Food lookup, or try again in an hour.');
  if (res.status === 403) throw new Error('USDA rejected the API key. Check it in Calorie needs → Food lookup.');
  if (!res.ok) throw new Error(`USDA lookup failed (${res.status})`);
  return res.json();
}

/** Energy is reported as 1008 "Energy" (SR Legacy, Branded) or 2047/2048 Atwater factors (Foundation foods). */
function macrosFrom(nutrients: Json[]): Macros {
  const pick = (...ids: number[]) => {
    for (const id of ids) {
      const n = nutrients.find((x) => (x.nutrientId ?? x.nutrient?.id) === id && /kcal|g/i.test(x.unitName ?? x.nutrient?.unitName ?? ''));
      const v = n?.value ?? n?.amount;
      if (typeof v === 'number') return Math.max(0, v);
    }
    return 0;
  };
  return { calories: pick(1008, 2047, 2048), protein: pick(1003), carbs: pick(1005), fat: pick(1004) };
}

export async function searchFoods(query: string, apiKey: string): Promise<FoodHit[]> {
  const q = new URLSearchParams({ query, pageSize: '12', dataType: 'Foundation,SR Legacy,Branded' });
  const data = await get(`${API}/foods/search?api_key=${keyParam(apiKey)}&${q}`);
  return (data.foods ?? []).map((f: Json) => ({
    fdcId: f.fdcId,
    description: f.description,
    dataType: f.dataType,
    brand: f.brandOwner ?? f.brandName ?? null,
    per100g: macrosFrom(f.foodNutrients ?? []),
    serving:
      f.servingSize && /^g/i.test(f.servingSizeUnit ?? '')
        ? { label: f.householdServingFullText ? `serving (${f.householdServingFullText})` : 'serving', grams: f.servingSize }
        : null,
  }));
}

/** Household portions ("1 cup = 195 g") for a food, when USDA has them. Failure just means grams only. */
export async function foodPortions(fdcId: number, apiKey: string): Promise<{ label: string; grams: number }[]> {
  try {
    const data = await get(`${API}/food/${fdcId}?api_key=${keyParam(apiKey)}`);
    return (data.foodPortions ?? [])
      .filter((p: Json) => p.gramWeight > 0)
      .map((p: Json) => {
        const unit = p.measureUnit?.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
        const raw = p.portionDescription || [unit, p.modifier].filter(Boolean).join(' ') || 'portion';
        // "RACC" is USDA's reference amount customarily consumed, i.e. a standard serving.
        const text = /^racc$/i.test(raw.trim()) ? 'standard serving' : raw;
        // Normalize "2 tbsp = 30 g" to one unit so the quantity field multiplies cleanly.
        return { label: text.trim(), grams: p.gramWeight / (p.amount || 1) };
      })
      .slice(0, 8);
  } catch {
    return [];
  }
}

export const toFoodRef = (hit: FoodHit, portions: { label: string; grams: number }[]): FoodRef => ({
  fdcId: hit.fdcId,
  description: hit.brand ? `${hit.description} (${hit.brand})` : hit.description,
  per100g: hit.per100g,
  gramsPerUnit: 1,
  portions: [...(hit.serving ? [hit.serving] : []), ...portions],
});
