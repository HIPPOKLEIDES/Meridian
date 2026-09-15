import type { BoardEdge, BoardNode, CardData, NoteNode, NotesData } from './types';
import { saveImage } from './assets';
import { uid } from '../store';
import { SAMPLE_MOD_PROJECT_ID } from '../lib/sample';

/** Draws a tiny pixel-art sprite from rows of palette characters ('.' is transparent). */
async function sprite(rows: string[], palette: Record<string, string>, name: string): Promise<string | null> {
  const canvas = document.createElement('canvas');
  canvas.width = rows[0].length;
  canvas.height = rows.length;
  const ctx = canvas.getContext('2d')!;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (palette[ch]) {
        ctx.fillStyle = palette[ch];
        ctx.fillRect(x, y, 1, 1);
      }
    }),
  );
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? saveImage(blob, name) : null;
}

const SPRITES = {
  fiber: {
    rows: ['............', '......g.....', '.....gG..g..', '.....gG.gG..', '....gG..gG..', '....gG.gG...', '...gG..gG...', '...gG.gG....', '...gGgG.....', '....gG......', '....g.......', '............'],
    palette: { g: '#3f8f2f', G: '#7cc251' },
  },
  twine: {
    rows: ['............', '...tttttt...', '..tTTTTTTt..', '.tT.tttt.Tt.', '.tTt....tTt.', '.tTt....tTt.', '.tT.tttt.Tt.', '..tTTTTTTt..', '...tttttt...', '.........t..', '..........t.', '............'],
    palette: { t: '#8a6a3b', T: '#c9a46a' },
  },
  flint: {
    rows: ['............', '.....kk.....', '....kKKk....', '...kKLKKk...', '...kKKLKk...', '..kKKKKLKk..', '..kKKKKKKk..', '...kKKKKk...', '....kKKk....', '.....kk.....', '............', '............'],
    palette: { k: '#2d2d33', K: '#5b5b66', L: '#9b9bab' },
  },
  axe: {
    rows: ['............', '.....sss....', '....sSSSs...', '....sSSSSs..', '.....sSSSs..', '......wSs...', '.....w......', '....w.......', '...w........', '..w.........', '.w..........', '............'],
    palette: { s: '#55555f', S: '#9696a3', w: '#8b5a2b' },
  },
  copper: {
    rows: ['............', '............', '...oooooo...', '..oOOOOOOo..', '.oOPPOOOOOo.', '.oOOOOOOOOo.', '.ooooooooooo', '.odddddddddo', '..ddddddddd.', '............', '............', '............'],
    palette: { o: '#b4602d', O: '#e08a4d', P: '#ffc08a', d: '#7a3e1c' },
  },
} as const;

export async function sampleNotes(): Promise<NotesData> {
  const projectId = SAMPLE_MOD_PROJECT_ID;
  const icons = Object.fromEntries(
    await Promise.all(Object.entries(SPRITES).map(async ([key, s]) => [key, await sprite([...s.rows], s.palette, `${key}.png`)] as const)),
  ) as Record<keyof typeof SPRITES, string | null>;

  const now = Date.now();
  const node = (p: Partial<NoteNode> & Pick<NoteNode, 'kind' | 'title'>): NoteNode => ({
    id: uid(),
    projectId,
    parentId: null,
    order: 0,
    color: null,
    content: '',
    board: null,
    createdAt: now,
    updatedAt: now,
    ...p,
  });

  const design = node({ kind: 'folder', title: 'Design', order: 0 });
  const survival = node({ kind: 'section', title: 'Survival mechanics', parentId: design.id, order: 0, color: 3 });
  const crafting = node({ kind: 'section', title: 'Crafting', parentId: design.id, order: 1, color: 2 });

  const thirst = node({
    kind: 'page',
    title: 'Thirst & water',
    parentId: survival.id,
    order: 0,
    content: `# Thirst & water

> Example note: replace with your own design.

Thirst drains faster than hunger and ties into [[Temperature]]: hot biomes drain it ~50% faster.

<style>
  .callout { border-left: 4px solid var(--series-1); background: color-mix(in srgb, var(--series-1) 12%, transparent); padding: 10px 14px; border-radius: 8px; }
  .callout b { color: var(--series-1); }
</style>

<div class="callout"><b>Design rule:</b> the player should find drinkable water within the first five minutes.</div>

## Sources

| Source | Restores | Risk |
| --- | --- | --- |
| River water | 3 | 20% chance of *Sickness* |
| Boiled water (clay pot) | 5 | none |
| Berries | 1 | none |

## To do
- [x] Decide drain rate per biome
- [ ] Clay pot recipe (needs [[Plant fibers]] twine handle)
- [ ] HUD icon
`,
  });
  const temperature = node({
    kind: 'page',
    title: 'Temperature',
    parentId: survival.id,
    order: 1,
    content: `# Temperature

Body temperature drifts toward the biome's temperature, modified by clothing and shelter.

- **Cold:** slower movement, faster hunger
- **Hot:** faster thirst (see [[Thirst & water]])

Crafted clothing comes from the [[Crafting progression]] board.
`,
  });
  const fibersPage = node({
    kind: 'page',
    title: 'Plant fibers',
    parentId: crafting.id,
    order: 1,
    content: `# Plant fibers

Dropped when breaking grass and ferns by hand (15%) or with a flint knife (40%). Where it fits in the tech tree: [[Crafting progression]].

\`\`\`json
{ "type": "minecraft:block", "pools": [{ "rolls": 1, "entries": [{ "type": "minecraft:item", "name": "conquest:plant_fiber" }] }] }
\`\`\`

Three fibers craft one **twine**, used for early tool bindings.
`,
  });
  const questions = node({
    kind: 'page',
    title: 'Open questions',
    order: 1,
    content: `# Open questions

- Should copper tools rust near water?
- Do we gate the bronze age behind a structure, or just recipes?
`,
  });

  const card = (x: number, y: number, data: Partial<CardData>): BoardNode => ({
    id: uid(),
    type: 'card',
    x,
    y,
    w: 190,
    h: null,
    data: { title: '', body: '', color: null, imageId: null, imageStyle: 'icon', pixelated: true, noteIds: [], ...data },
  });
  const fiberCard = card(60, 90, { title: 'Plant fiber', body: 'Grass & ferns, 15% by hand', imageId: icons.fiber, color: 3, noteIds: [fibersPage.id] });
  const flintCard = card(60, 230, { title: 'Flint shard', body: 'Gravel, sifted', imageId: icons.flint });
  const twineCard = card(340, 90, { title: 'Twine', body: '3 × plant fiber', imageId: icons.twine, color: 3 });
  const knifeCard = card(340, 230, { title: 'Flint knife', body: 'Flint + stick + twine. Doubles fiber drops.', imageId: icons.flint });
  const axeCard = card(620, 160, { title: 'Stone axe', body: 'Unlocks logs → planks', imageId: icons.axe, color: 7 });
  const oreCard = card(960, 110, { title: 'Copper ore', body: 'Surface veins near rivers', imageId: icons.copper, color: 2 });
  const ingotCard = card(1220, 110, { title: 'Copper ingot', body: 'Smelt in a clay furnace. See [[Open questions]].', imageId: icons.copper, color: 2 });
  const toolsCard = card(1220, 260, { title: 'Copper tools', body: 'Durability: TBD', color: 2, imageStyle: 'icon' });

  const frame = (x: number, y: number, w: number, h: number, title: string, color: number): BoardNode => ({ id: uid(), type: 'frame', x, y, w, h, data: { title, color } });
  const edge = (source: BoardNode, target: BoardNode, label = '', dashed = false): BoardEdge => ({
    id: uid(),
    source: source.id,
    target: target.id,
    sourceHandle: 'right',
    targetHandle: 'left',
    label,
    dashed,
  });

  const board = node({
    kind: 'board',
    title: 'Crafting progression',
    parentId: crafting.id,
    order: 0,
    board: {
      nodes: [
        frame(20, 20, 560, 340, 'Tier 0 · Foraging', 3),
        frame(600, 20, 290, 340, 'Tier 1 · Stone', 7),
        frame(920, 20, 540, 340, 'Tier 2 · Copper', 2),
        fiberCard,
        flintCard,
        twineCard,
        knifeCard,
        axeCard,
        oreCard,
        ingotCard,
        toolsCard,
      ],
      edges: [
        edge(fiberCard, twineCard, 'crafts'),
        edge(flintCard, knifeCard, 'crafts'),
        edge(twineCard, knifeCard, 'binding'),
        edge(knifeCard, axeCard, 'unlocks'),
        edge(axeCard, oreCard, 'reach', true),
        edge(oreCard, ingotCard, 'smelts'),
        edge(ingotCard, toolsCard, 'crafts'),
      ],
    },
  });

  return { notes: [design, survival, crafting, thirst, temperature, fibersPage, board, questions] };
}
