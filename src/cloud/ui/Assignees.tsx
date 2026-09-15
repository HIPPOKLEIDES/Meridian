import type { Task } from '../../types';
import { memberName, useProjectMembers, useSharing, isTaskForMe } from '../sharing';
import { useSession } from '../session';
import { Avatar, AvatarStack } from './Avatars';
import { Icon } from '../../components/common';

/** Choose who a task in a shared project is assigned to. Renders nothing for unshared projects. */
export function AssigneePicker({ projectId, value, onChange }: { projectId: string | null; value: string[]; onChange: (ids: string[]) => void }) {
  const members = useProjectMembers(projectId);
  if (members.length < 2) return null;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="field">
      <span className="field-label">Assigned to</span>
      <div className="assignee-options">
        {members.map((m) => (
          <button
            key={m.userId}
            type="button"
            role="checkbox"
            aria-checked={value.includes(m.userId)}
            className={`assignee-option${value.includes(m.userId) ? ' is-on' : ''}`}
            onClick={() => toggle(m.userId)}
          >
            <Avatar member={m} size={20} />
            {memberName(m)}
            {value.includes(m.userId) && <Icon name="check" size={12} />}
          </button>
        ))}
      </div>
      <span className="field-hint">{value.length ? 'Shows on their Today and Calendar.' : 'Unassigned tasks show only for whoever created them.'}</span>
    </div>
  );
}

/** Avatars of a task's assignees (shared projects only). */
export function TaskAssignees({ task }: { task: Task }) {
  const members = useProjectMembers(task.projectId);
  if (members.length < 2 || !task.assigneeIds?.length) return null;
  const assigned = members.filter((m) => task.assigneeIds!.includes(m.userId));
  return <AvatarStack members={assigned} size={18} max={3} />;
}

/** Filters tasks to the ones that belong on your own lists; re-renders when membership changes. */
export function useTasksForMe<T extends Task>(tasks: T[]): T[] {
  const members = useSharing((s) => s.members);
  const me = useSession((s) => s.user?.id ?? null);
  return me ? tasks.filter((t) => isTaskForMe(t, members, me)) : tasks;
}
