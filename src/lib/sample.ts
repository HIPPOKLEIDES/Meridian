import type { AppData, DateKey, Habit, Task, TimeEntry } from '../types';
import { emptyData, newBlock, newEntry, newHabit, newProject, newTask } from '../store';
import { addDays, nowMinutes, todayKey, weekday } from './dates';
import { layoutFlow } from './tasks';

/** Project that the sample notes and flowmap board belong to. */
export const SAMPLE_MOD_PROJECT_ID = 'sample-conquest-mod';

/** Habits and a project that the sample goals link to. */
export const SAMPLE_CONVO_HABIT_ID = 'sample-new-conversation';
export const SAMPLE_CALL_HABIT_ID = 'sample-call-friend';
export const SAMPLE_SPANISH_PROJECT_ID = 'sample-spanish';
export const SAMPLE_FLASHCARDS_HABIT_ID = 'sample-flashcards';

/** Habit referenced by the sample knee injury's rehab routine. */
export const SAMPLE_REHAB_HABIT_ID = 'sample-knee-rehab';

/** Deterministic PRNG so the sample looks the same every time. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sub = (...texts: string[]) => texts.map((text, i) => ({ id: `s${i}${text.length}`, text, done: false }));

/** A realistic few weeks of data, relative to today, for exploring the app. */
export function sampleData(): AppData {
  const rand = mulberry32(42);
  const today = todayKey();
  const d = (n: number) => addDays(today, n);
  const data = emptyData();

  const portfolio = newProject({
    name: 'Portfolio website',
    description: 'A simple site with three case studies, live before the end of the month.',
    areaId: 'career',
    priority: 'high',
  });
  const spanish = newProject({
    id: SAMPLE_SPANISH_PROJECT_ID,
    name: 'Conversational Spanish',
    description: 'Hold a 10-minute conversation with a native speaker.',
    areaId: 'knowledge',
    priority: 'medium',
  });
  const gym = newProject({
    name: 'Home gym corner',
    description: 'Enough kit to train at home on rainy days.',
    areaId: 'health',
    priority: 'low',
  });
  const mod = newProject({
    id: SAMPLE_MOD_PROJECT_ID,
    name: 'Conquest Reforged: survival & crafting',
    description: 'Design the early-game survival loop and the crafting progression from foraging to copper.',
    areaId: 'knowledge',
    priority: 'medium',
  });
  data.projects = [portfolio, spanish, gym, mod];

  const t = (p: Partial<Task>) => newTask(p);
  const samples = t({ title: 'Collect best work samples', projectId: portfolio.id, priority: 'high', status: 'done', startDate: d(-12), endDate: d(-9), completedAt: Date.now() });
  const domain = t({ title: 'Pick domain & hosting', projectId: portfolio.id, priority: 'medium', status: 'done', startDate: d(-8), endDate: d(-8), completedAt: Date.now() });
  const outline = t({
    title: 'Outline case studies',
    projectId: portfolio.id,
    priority: 'high',
    status: 'done',
    startDate: d(-7),
    endDate: d(-4),
    dependsOn: [samples.id],
    subtasks: sub('Problem', 'Process', 'Outcome').map((s) => ({ ...s, done: true })),
    completedAt: Date.now(),
  });
  const mockup = t({
    title: 'Design homepage mockup',
    projectId: portfolio.id,
    priority: 'urgent',
    status: 'doing',
    startDate: d(-2),
    endDate: d(2),
    dependsOn: [outline.id],
    subtasks: [
      { id: 'm1', text: 'Moodboard', done: true },
      { id: 'm2', text: 'Wireframe', done: true },
      { id: 'm3', text: 'High-fidelity mockup', done: false },
      { id: 'm4', text: 'Mobile layout', done: false },
    ],
  });
  const write = t({
    title: 'Write the three case studies',
    projectId: portfolio.id,
    priority: 'high',
    startDate: d(0),
    endDate: d(6),
    dependsOn: [outline.id],
    subtasks: sub('Case study: rebrand', 'Case study: mobile app', 'Case study: dashboard'),
  });
  const build = t({ title: 'Build the site', projectId: portfolio.id, priority: 'high', startDate: d(3), endDate: d(9), dependsOn: [mockup.id, domain.id], subtasks: sub('Set up repo & deploy', 'Homepage', 'Case study template', 'Contact form') });
  const feedback = t({ title: 'Get feedback from three friends', projectId: portfolio.id, areaId: 'social', priority: 'medium', startDate: d(10), endDate: d(11), dependsOn: [build.id, write.id] });
  const launch = t({ title: 'Launch & announce', projectId: portfolio.id, priority: 'high', startDate: d(12), endDate: d(12), dependsOn: [feedback.id], subtasks: sub('Post on LinkedIn', 'Email past clients') });

  const vocab = t({ title: 'Learn 300 core words', projectId: spanish.id, priority: 'high', status: 'doing', startDate: d(-10), endDate: d(8), subtasks: [{ id: 'v1', text: 'First 100', done: true }, { id: 'v2', text: 'Next 100', done: false }, { id: 'v3', text: 'Last 100', done: false }] });
  const grammar = t({ title: 'Present & past tense drills', projectId: spanish.id, priority: 'medium', startDate: d(1), endDate: d(14) });
  const tutor = t({ title: 'Book a tutor on italki', projectId: spanish.id, priority: 'medium', dependsOn: [vocab.id] });
  const convo = t({ title: '10-minute conversation', projectId: spanish.id, priority: 'high', dependsOn: [tutor.id, grammar.id] });

  const research = t({ title: 'Research equipment', projectId: gym.id, priority: 'low', status: 'done', completedAt: Date.now() });
  const clear = t({ title: 'Clear the spare-room corner', projectId: gym.id, priority: 'low', startDate: d(5), endDate: d(5) });
  const buy = t({ title: 'Buy kettlebell, mat & bands', projectId: gym.id, priority: 'low', dependsOn: [research.id, clear.id] });

  const passport = t({ title: 'Renew passport', priority: 'urgent', startDate: d(1), endDate: d(3), subtasks: sub('Photos', 'Fill in form', 'Post it') });
  const birthday = t({ title: "Plan Sam's birthday dinner", areaId: 'social', priority: 'medium', startDate: d(4), endDate: d(6), subtasks: sub('Book restaurant', 'Invite friends') });
  const taxes = t({ title: 'Sort receipts for taxes', areaId: 'career', priority: 'low' });

  const designDoc = t({ title: 'Write survival mechanics notes', projectId: mod.id, priority: 'high', status: 'done', completedAt: Date.now() });
  const mapTiers = t({ title: 'Map crafting progression tiers', projectId: mod.id, priority: 'high', status: 'doing', dependsOn: [designDoc.id] });
  const fibers = t({ title: 'Prototype plant fiber drops', projectId: mod.id, priority: 'medium', dependsOn: [mapTiers.id], subtasks: sub('Loot table override', 'Drop chance config', 'Twine recipe') });
  const copper = t({ title: 'Balance copper tool durability', projectId: mod.id, priority: 'medium', dependsOn: [fibers.id] });
  const playtest = t({ title: 'Playtest the first hour', projectId: mod.id, priority: 'low', dependsOn: [copper.id] });

  data.tasks = [samples, domain, outline, mockup, write, build, feedback, launch, vocab, grammar, tutor, convo, research, clear, buy, passport, birthday, taxes, designDoc, mapTiers, fibers, copper, playtest];
  for (const project of data.projects) {
    const pos = layoutFlow(data.tasks.filter((x) => x.projectId === project.id));
    data.tasks = data.tasks.map((x) => (pos[x.id] ? { ...x, flow: pos[x.id] } : x));
  }

  const habit = (h: Partial<Habit>, historyDays: number, rate: number): Habit => {
    const made = newHabit({ ...h, startDate: d(-historyDays) });
    for (let i = historyDays; i >= 1; i--) {
      const day = d(-i);
      // Fewer misses recently, so streaks and strength curves look like a habit taking hold.
      const r = i < historyDays / 3 ? rate + (1 - rate) * 0.6 : rate;
      if (made.days.includes(weekday(day)) && rand() < r) {
        made.log[day] = { done: true, steps: made.steps.map((s) => s.id) };
      }
    }
    return made;
  };
  data.habits = [
    habit({ title: 'Meditate', areaId: 'health', start: 6 * 60 + 45, duration: 10 }, 45, 0.8),
    habit({ title: 'Morning run', areaId: 'health', days: [1, 3, 5], start: 7 * 60, duration: 40, steps: [{ id: 'r1', text: 'Stretch' }, { id: 'r2', text: 'Run 5 km' }, { id: 'r3', text: 'Cool down' }] }, 90, 0.75),
    habit(
      {
        id: SAMPLE_REHAB_HABIT_ID,
        title: 'Knee rehab exercises',
        areaId: 'health',
        start: 7 * 60 + 45,
        duration: 20,
        steps: [
          { id: 'k1', text: 'Wall sit 5 × 45 s' },
          { id: 'k2', text: 'Decline squats 3 × 15' },
          { id: 'k3', text: 'Foam roll quads' },
        ],
      },
      30,
      0.8,
    ),
    habit({ id: SAMPLE_FLASHCARDS_HABIT_ID, title: 'Spanish flashcards', areaId: 'knowledge', start: 12 * 60 + 45, duration: 15 }, 30, 0.7),
    habit({ title: 'Review day & plan tomorrow', areaId: 'career', days: [1, 2, 3, 4, 5], start: 17 * 60 + 30, duration: 15, steps: [{ id: 'p1', text: 'Log hours' }, { id: 'p2', text: 'Check off tasks' }, { id: 'p3', text: 'Pick top 3 for tomorrow' }] }, 20, 0.6),
    habit({ title: 'Read', areaId: 'knowledge', start: 21 * 60 + 30, duration: 30 }, 60, 0.65),
    habit({ id: SAMPLE_CALL_HABIT_ID, title: 'Call a friend or family', areaId: 'social', days: [0, 6], start: null, duration: 20 }, 40, 0.7),
    habit({ id: SAMPLE_CONVO_HABIT_ID, title: 'Start a conversation with someone new', areaId: 'social', days: [1, 2, 3, 4, 5, 6], start: null, duration: 5 }, 35, 0.55),
  ];

  data.blocks = [
    newBlock({ title: 'Deep work', date: d(-30), start: 9 * 60, end: 12 * 60, repeatDays: [1, 2, 3, 4, 5], areaId: 'career', taskId: mockup.id }),
    newBlock({ title: 'Admin & email', date: d(-30), start: 13 * 60 + 30, end: 14 * 60 + 30, repeatDays: [1, 2, 3, 4, 5], areaId: 'career' }),
    newBlock({ title: 'Portfolio writing', date: d(-30), start: 15 * 60, end: 17 * 60, repeatDays: [1, 3], areaId: 'career', taskId: write.id }),
    newBlock({ title: 'Spanish class', date: d(-30), start: 18 * 60 + 30, end: 19 * 60 + 30, repeatDays: [2, 4], areaId: 'knowledge' }),
    newBlock({ title: 'Dinner with Sam', date: today, start: 19 * 60 + 30, end: 21 * 60, areaId: 'social' }),
  ];

  // Logged time: habit completions plus a few weeks of work, study and social time.
  const entries: TimeEntry[] = [];
  for (const h of data.habits) {
    for (const [day, rec] of Object.entries(h.log)) {
      if (!rec.done || h.duration <= 0) continue;
      const start = h.start ?? 18 * 60;
      entries.push(newEntry({ label: h.title, date: day, start, end: start + h.duration, areaId: h.areaId, habitId: h.id }));
    }
  }
  const nowMin = nowMinutes();
  const add = (day: DateKey, label: string, areaId: string, start: number, len: number) => {
    const end = start + len;
    if (day === today && end > nowMin) return;
    entries.push(newEntry({ label, date: day, start, end, areaId }));
  };
  for (let i = 21; i >= 0; i--) {
    const day = d(-i);
    const wd = weekday(day);
    const jitter = () => Math.round(rand() * 4) * 15;
    if (wd >= 1 && wd <= 5) {
      add(day, 'Deep work', 'career', 9 * 60 + jitter() / 3, 150 + jitter());
      add(day, 'Admin & email', 'career', 13 * 60 + 30, 45 + jitter());
      if (rand() < 0.6) add(day, 'Portfolio website', 'career', 15 * 60, 90 + jitter());
      if (wd === 2 || wd === 4) add(day, 'Spanish class', 'knowledge', 18 * 60 + 30, 60);
    } else {
      if (rand() < 0.7) add(day, 'Brunch with friends', 'social', 11 * 60, 90 + jitter());
      if (rand() < 0.5) add(day, 'Online course', 'knowledge', 15 * 60, 60 + jitter());
      if (rand() < 0.5) add(day, 'Hike', 'health', 9 * 60, 120);
    }
    if (rand() < 0.35) add(day, 'Dinner out', 'social', 19 * 60, 90 + jitter());
  }
  data.entries = entries;
  return data;
}
