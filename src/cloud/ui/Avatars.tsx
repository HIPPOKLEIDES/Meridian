import type { CSSProperties } from 'react';
import { initials, memberName, type Member } from '../sharing';

/** Stable color slot per person, so someone looks the same everywhere. */
const slotFor = (userId: string) => {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 8) + 1;
};

export function Avatar({ member, size = 22 }: { member: Pick<Member, 'userId' | 'displayName' | 'email'>; size?: number }) {
  const slot = slotFor(member.userId);
  return (
    <span
      className="avatar"
      title={memberName(member)}
      style={{ '--avatar-bg': `var(--series-${slot})`, '--avatar-ink': `var(--on-series-${slot})`, width: size, height: size, fontSize: size * 0.42 } as CSSProperties}
    >
      {initials(member)}
    </span>
  );
}

export function AvatarStack({ members, max = 4, size = 22 }: { members: Pick<Member, 'userId' | 'displayName' | 'email'>[]; max?: number; size?: number }) {
  if (!members.length) return null;
  const shown = members.slice(0, max);
  return (
    <span className="avatar-stack" aria-label={members.map(memberName).join(', ')}>
      {shown.map((m) => (
        <Avatar key={m.userId} member={m} size={size} />
      ))}
      {members.length > max && (
        <span className="avatar avatar-more" style={{ width: size, height: size, fontSize: size * 0.42 }}>
          +{members.length - max}
        </span>
      )}
    </span>
  );
}
