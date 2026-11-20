import type { NurseRole, PublicNurse } from '@carelayer/shared';

const ROLE_LABELS: Record<NurseRole, string> = {
  nurse: 'Registered nurse',
  midwife: 'Registered midwife',
};

export function nurseRoleLabel(role: NurseRole): string {
  return ROLE_LABELS[role];
}

/** "Amaka Okafor" -> "Amaka O." (Figma W12). A single name is shown as is. */
export function shortNurseName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
}

/** "Amaka O., Registered midwife". */
export function nurseLine(nurse: PublicNurse): string {
  return `${shortNurseName(nurse.displayName)}, ${nurseRoleLabel(nurse.role)}`;
}
