import { useEffect } from 'react';
import { Icon } from './components/common';
import { DialogHost } from './components/editors';
import { MiniTimer, TaskDragGhost, Toasts } from './components/widgets';
import { InstallNudge } from './components/install';
import { navigate, useResolvedTheme, useRoute } from './lib/hooks';
import { todayKey } from './lib/dates';
import { TodayView } from './views/Today';
import { TasksView } from './views/Tasks';
import { HabitsView } from './views/Habits';
import { CalendarView } from './views/Calendar';
import { ProjectDetail, ProjectsView } from './views/Projects';
import { AreasView } from './views/Areas';
import { SettingsView } from './views/Settings';
import { HealthView } from './health/HealthView';
import { FinanceView } from './finance/FinanceView';
import { JournalView } from './journal/JournalView';
import { GoalsView } from './goals/GoalsView';
import { GoalReview } from './goals/GoalReview';
import { CoachView } from './ai/CoachView';
import { JoinView } from './cloud/ui/JoinView';
import { SyncIndicator } from './cloud/ui/SyncIndicator';
import { CloudDialogs } from './cloud/ui/CloudDialogs';

const NAV = [
  { id: 'today', label: 'Today', icon: 'clock' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'habits', label: 'Habits', icon: 'habits' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'journal', label: 'Journal', icon: 'journal' },
  { id: 'projects', label: 'Projects & goals', icon: 'projects' },
  { id: 'areas', label: 'Life areas', icon: 'areas' },
  { id: 'health', label: 'Health', icon: 'heart' },
  { id: 'finance', label: 'Finance', icon: 'wallet' },
  { id: 'coach', label: 'Coach', icon: 'spark' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function App() {
  const [section = 'today', a, b, c] = useRoute();
  const theme = useResolvedTheme();
  // Goals live under the Projects nav item.
  const navSection = section === 'goals' ? 'projects' : section;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  let view;
  switch (section) {
    case 'tasks':
      view = <TasksView />;
      break;
    case 'habits':
      view = <HabitsView selectedId={a} />;
      break;
    case 'calendar':
      view = <CalendarView month={a} />;
      break;
    case 'projects':
      view = a ? <ProjectDetail id={a} tab={b} sub={c} /> : <ProjectsView />;
      break;
    case 'goals':
      view = a === 'review' ? <GoalReview /> : <GoalsView id={a} />;
      break;
    case 'join':
      view = <JoinView token={a} />;
      break;
    case 'journal':
      view = <JournalView journalId={a} date={b && /^\d{4}-\d{2}-\d{2}$/.test(b) ? b : undefined} />;
      break;
    case 'areas':
      view = <AreasView />;
      break;
    case 'health':
      view = <HealthView tab={a} id={b} />;
      break;
    case 'finance':
      view = <FinanceView tab={a} id={b} />;
      break;
    case 'coach':
      view = <CoachView />;
      break;
    case 'settings':
      view = <SettingsView />;
      break;
    default:
      view = <TodayView date={a && /^\d{4}-\d{2}-\d{2}$/.test(a) ? a : todayKey()} />;
  }

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Meridian
        </div>
        <ul className="nav">
          {NAV.map((n) => (
            <li key={n.id}>
              <button
                className={`nav-item${navSection === n.id || (n.id === 'today' && !NAV.some((x) => x.id === navSection)) ? ' is-active' : ''}`}
                aria-current={navSection === n.id ? 'page' : undefined}
                onClick={() => navigate(n.id)}
              >
                <Icon name={n.icon} size={18} />
                <span>{n.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <MiniTimer />
        <SyncIndicator />
        <InstallNudge />
      </nav>
      <main className="main">{view}</main>
      <DialogHost />
      <CloudDialogs />
      <Toasts />
      <TaskDragGhost />
    </div>
  );
}
