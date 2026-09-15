import type { DateKey } from '../types';
import type { CheckIn, GoalsData, LifeGoal, Signal } from './types';
import { DEFAULT_PROMPTS } from './types';
import { newGoal } from './store';
import { addDays, todayKey, weekday } from '../lib/dates';
import {
  mulberry32,
  SAMPLE_CALL_HABIT_ID,
  SAMPLE_CONVO_HABIT_ID,
  SAMPLE_FLASHCARDS_HABIT_ID,
  SAMPLE_MOD_PROJECT_ID,
  SAMPLE_SPANISH_PROJECT_ID,
} from '../lib/sample';

/** Open-ended sample goals with a couple of months of check-ins, signals and wins. */
export function sampleGoals(): GoalsData {
  const rand = mulberry32(11);
  const today = todayKey();
  const d = (n: number): DateKey => addDays(today, n);
  let n = 0;
  const id = (prefix: string) => `${prefix}-${++n}`;

  /** [days ago, rating, [tried, happened, learned], next step] */
  const checkIns = (list: [number, number, [string, string, string], string][]): CheckIn[] =>
    list.map(([ago, rating, answers, next]) => ({
      id: id('ci'),
      date: d(-ago),
      rating,
      answers: DEFAULT_PROMPTS.map((prompt, i) => ({ prompt, text: answers[i] })).filter((a) => a.text),
      note: '',
      next,
    }));
  const weekly = (weeks: number, value: (w: number) => number): Signal['entries'] =>
    Array.from({ length: weeks }, (_, i) => {
      const ago = (weeks - 1 - i) * 7 + 1;
      return { id: id('sv'), date: d(-ago), value: Math.max(0, Math.round(value(i))), note: '' };
    });

  const speaking: LifeGoal = newGoal({
    id: 'sample-goal-speaking',
    title: 'Speak up more in groups',
    tag: 'speaking-up',
    why: 'In meetings and group conversations I stay quiet even when I have something useful to say, and afterwards I wish I had said it.',
    vision: 'Sharing ideas in the moment without rehearsing them first. People ask for my opinion because they know I will give one. Being interrupted or disagreed with feels normal, not crushing.',
    status: 'active',
    horizon: 'season',
    areaId: 'career',
    milestones: [
      { id: id('m'), text: 'Share one idea in the weekly team meeting', doneOn: d(-48) },
      { id: id('m'), text: 'Ask a question at a meetup', doneOn: d(-33) },
      { id: id('m'), text: 'Disagree respectfully in a meeting', doneOn: d(-12) },
      { id: id('m'), text: 'Give a 5-minute talk', doneOn: null },
      { id: id('m'), text: 'Lead a meeting from start to finish', doneOn: null },
    ],
    signals: [
      {
        id: id('sig'),
        name: 'Times I spoke up in meetings',
        unit: 'per week',
        better: 'up',
        target: 5,
        entries: weekly(9, (w) => 1 + w * 0.45 + (rand() * 2 - 1)),
      },
    ],
    checkIns: checkIns([
      [56, 3, ['Nothing yet, just noticing.', 'Stayed silent in three meetings with ideas I never shared.', 'I wait for a "perfect" moment that never comes.'], 'Say one thing in the Tuesday meeting, even if small'],
      [42, 4, ['Said one thing on Tuesday.', 'Nobody reacted much, which was a relief.', 'The fear is bigger than the actual moment.'], 'Write one point down before each meeting'],
      [28, 5, ['Wrote points down beforehand.', 'Spoke up twice; one idea got picked up.', 'Having a note makes it easier to jump in.'], 'Ask a question at the design meetup'],
      [14, 6, ['Asked a question at the meetup.', 'Someone came up afterwards to keep talking about it.', 'Questions are an easy way in.'], 'Disagree with something in a meeting, politely'],
      [7, 7, ['Pushed back on a timeline.', "We changed the plan. Nobody was upset.", 'Disagreeing well is useful, not rude.'], 'Volunteer to present the sprint demo'],
    ]),
    wins: [
      { id: id('w'), date: d(-44), text: 'Shared an idea in the team meeting' },
      { id: id('w'), date: d(-27), text: 'My suggestion made it into the project plan' },
      { id: id('w'), date: d(-15), text: 'Asked a question in front of ~40 people' },
      { id: id('w'), date: d(-10), text: 'Pushed back on an unrealistic deadline' },
    ],
    habitIds: [SAMPLE_CONVO_HABIT_ID],
    notes: 'Jotting one point down before a meeting works better than trying to think of something on the spot.\nIdea: treat nerves as excitement, not a signal to stop.',
  });

  const friendships: LifeGoal = newGoal({
    id: 'sample-goal-friends',
    title: 'Build deeper friendships',
    tag: 'friends',
    why: 'Most of my friendships are running on autopilot, with group chats and the occasional birthday. I want a few people I really know and who really know me.',
    vision: 'Two or three friends I see regularly and could call about anything. Plans happen without weeks of back-and-forth.',
    status: 'active',
    horizon: 'year',
    areaId: 'social',
    milestones: [
      { id: id('m'), text: 'Reconnect with two old friends', doneOn: d(-30) },
      { id: id('m'), text: 'Start a regular thing (weekly climbing, monthly dinner…)', doneOn: d(-18) },
      { id: id('m'), text: 'Host a dinner at home', doneOn: null },
      { id: id('m'), text: 'Plan a weekend trip with friends', doneOn: null },
    ],
    signals: [
      {
        id: id('sig'),
        name: 'Real conversations (not texts)',
        unit: 'per week',
        better: 'up',
        target: 3,
        entries: weekly(6, (w) => 1 + w * 0.35 + rand()),
      },
    ],
    checkIns: checkIns([
      [38, 3, ['Messaged a few people.', "Lots of 'we should catch up!' and no actual plans.", 'Vague invites go nowhere.'], 'Suggest a specific day and place'],
      [24, 5, ['Suggested Thursday climbing to Alex.', "It's now a weekly thing.", 'Recurring plans remove all the scheduling friction.'], 'Call Mom and one old friend this weekend'],
      [10, 6, ['Two long calls.', "Felt closer after an hour than after a year of texts.", 'I like phone calls more than I expected.'], "Plan Sam's birthday dinner"],
    ]),
    wins: [
      { id: id('w'), date: d(-29), text: 'Two-hour call with an old school friend' },
      { id: id('w'), date: d(-19), text: 'First weekly climbing session with Alex' },
      { id: id('w'), date: d(-6), text: 'Birthday dinner planned, eight people coming' },
    ],
    habitIds: [SAMPLE_CALL_HABIT_ID],
  });

  const spanish: LifeGoal = newGoal({
    id: 'sample-goal-spanish',
    title: 'Speak Spanish without translating in my head',
    tag: 'spanish',
    why: 'Trip to Mexico City next spring, and I want to talk to people, not just order food.',
    vision: 'Following a casual conversation at normal speed and answering without composing sentences in English first.',
    status: 'active',
    horizon: 'year',
    areaId: 'knowledge',
    milestones: [
      { id: id('m'), text: 'Understand a slow podcast episode without subtitles', doneOn: d(-12) },
      { id: id('m'), text: '10-minute conversation with a tutor', doneOn: null },
      { id: id('m'), text: 'Watch a film in Spanish with Spanish subtitles', doneOn: null },
    ],
    checkIns: checkIns([
      [40, 4, ['Flashcards every day.', 'Vocabulary is growing, but listening is rough.', 'Reading and listening are separate skills.'], 'Add a podcast on the commute'],
      [19, 5, ['Podcast on walks.', 'Understood most of an episode today!', 'Slow podcasts are the right level.'], 'Book a tutor'],
    ]),
    habitIds: [SAMPLE_FLASHCARDS_HABIT_ID],
    projectIds: [SAMPLE_SPANISH_PROJECT_ID],
  });

  const community: LifeGoal = newGoal({
    id: 'sample-goal-community',
    title: 'Grow a small community around the mod',
    tag: 'mod',
    why: 'Feedback from real players would make the design so much better, and it would be fun to build something with other people.',
    vision: 'An active Discord with a few dozen regulars who playtest updates and share builds.',
    status: 'exploring',
    horizon: 'someday',
    areaId: 'knowledge',
    milestones: [
      { id: id('m'), text: 'Post a dev log with screenshots', doneOn: null },
      { id: id('m'), text: 'Open a Discord server', doneOn: null },
    ],
    projectIds: [SAMPLE_MOD_PROJECT_ID],
  });

  const reading: LifeGoal = newGoal({
    id: 'sample-goal-reading',
    title: 'Fall back in love with reading',
    tag: 'reading',
    why: 'Phone scrolling had replaced books entirely.',
    status: 'achieved',
    horizon: 'season',
    areaId: 'knowledge',
    milestones: [
      { id: id('m'), text: 'Finish a novel', doneOn: d(-70) },
      { id: id('m'), text: 'Read before bed for a month', doneOn: d(-40) },
    ],
    checkIns: checkIns([
      [90, 3, ['Short books only.', 'Finished one in a week.', 'Starting small works.'], 'Leave the phone charging in the kitchen'],
      [60, 6, ['Phone out of the bedroom.', 'Finished two more books.', 'The environment matters more than willpower.'], 'Keep the bedtime slot'],
      [38, 9, ['Nothing special.', 'Reading most nights without thinking about it.', "It's a habit now."], ''],
    ]),
  });

  // The last review was just over a week ago, so the sample shows this week's review as due.
  const lastReview = addDays(today, -((weekday(today) + 7) % 7) - 7);
  return {
    goals: [speaking, friendships, spanish, community, reading],
    reviewDay: 0,
    reviews: [{ id: 'sample-review-1', date: lastReview, goalIds: [speaking.id, friendships.id, spanish.id] }],
  };
}
