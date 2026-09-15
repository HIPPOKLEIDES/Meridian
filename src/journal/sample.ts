import type { DateKey } from '../types';
import type { JournalData, JournalEntry, Mood } from './types';
import { DEFAULT_JOURNAL_ID } from './store';
import { addDays, todayKey } from '../lib/dates';

const GRATITUDE_ID = 'sample-gratitude';

/** Two journals with a few weeks of entries, relative to today. */
export function sampleJournal(): JournalData {
  const today = todayKey();
  const d = (n: number): DateKey => addDays(today, n);
  const entries: JournalEntry[] = [];
  const add = (journalId: string, ago: number, mood: Mood | null, text: string) => {
    const at = new Date(d(-ago) + 'T21:30:00').getTime();
    entries.push({ id: `sample-${journalId}-${ago}`, journalId, date: d(-ago), mood, text, createdAt: at, updatedAt: at });
  };

  const daily: [number, Mood, string][] = [
    [19, 2, "Couldn't sleep again. Kept replaying the team meeting where I had a good idea about the onboarding flow and just... didn't say it. Someone else suggested something similar ten minutes later.\n\nThings that are actually fine: the portfolio is coming along, knee feels better after rehab.\n\n#speaking-up #sleep"],
    [18, 3, 'Better day. Did the knee exercises before work and the wall sits finally feel manageable. Spent the evening on the mod design doc and lost track of time in a good way.\n\n#knee #mod'],
    [17, 3, 'Work was a lot of admin. Talked to the barista about the book she was reading, which counts as a new conversation, I guess. Felt awkward but she was friendly.'],
    [15, 4, "Long walk with Sam. Laughed a lot. Realized we've been friends for ten years and I still rarely ask how they're really doing.\n\n#friends"],
    [14, 4, 'Wrote down two points before the Tuesday meeting and actually said both. One of them turned into an action item. Tiny thing, but my heart was pounding.\n\n#speaking-up'],
    [12, 3, 'Dull day. Not bad, just flat. Did Spanish flashcards on autopilot. I should mix it up with a podcast.\n\n#spanish'],
    [11, 2, "Knee flared up after the run. Annoyed at myself for skipping the warm-up. Iced it, did the rehab anyway.\n\nNoticing that when my body feels bad, everything feels worse, like I'm behind on everything.\n\n#knee"],
    [10, 3, 'Quiet evening. Mapped out the crafting tiers for the mod: foraging → flint → copper. The plant fiber idea feels right.\n\n#mod'],
    [8, 4, '— 8:15 PM —\nGood conversation at the climbing gym with someone new. Twenty minutes that went by in no time. I didn’t rehearse anything, just asked questions.\n\nMaybe that works in meetings too: ask a question instead of waiting for a perfect point.\n\n#speaking-up #climbing'],
    [7, 5, 'Great day. Portfolio mockup is done, knee felt solid on the run, and Alex said yes to making Thursday climbing a weekly thing. Remember this day when things feel stuck.\n\n#friends #work'],
    [6, 4, "Called Mom. She's doing well. Made plans for Sam's birthday dinner.\n\n#family #friends"],
    [5, 3, 'Tired. Too much screen time. Going to bed early.'],
    [4, 4, 'Volunteered to present the sprint demo on Friday. Nervous, but more excited than nervous, which is new.\n\n#speaking-up'],
    [3, 4, "The demo went fine. I stumbled once, laughed it off, and kept going. Nobody cared. I didn't replay it all evening either. That's the actual win.\n\n#speaking-up #work"],
    [2, 3, 'Admin day. Sorted receipts for quarterly taxes. Not fun, but it feels good to have it done.\n\n#money'],
    [1, 4, 'Long walk, podcast in Spanish. Understood most of it! Planning to book a tutor this week.\n\n#spanish'],
  ];
  for (const [ago, mood, text] of daily) add(DEFAULT_JOURNAL_ID, ago, mood, text);

  const gratitude: [number, string][] = [
    [14, '- Sam taking photos and making it fun\n- Sunny walk\n- Coffee from the new place'],
    [8, '- A good conversation with a stranger\n- Knee holding up'],
    [6, "- Mom's laugh on the phone\n- Having friends worth planning a birthday for"],
    [1, '- Understanding Spanish in the wild\n- A slow Sunday'],
  ];
  for (const [ago, text] of gratitude) add(GRATITUDE_ID, ago, null, text);

  return {
    journals: [
      { id: DEFAULT_JOURNAL_ID, name: 'Daily', color: 1, prompts: [], createdAt: 0 },
      {
        id: GRATITUDE_ID,
        name: 'Gratitude',
        color: 3,
        prompts: ['Three things you’re grateful for today', 'Who made today better?', 'What small thing went right?'],
        createdAt: 0,
      },
    ],
    entries,
  };
}
