/**
 * Utility to check if a user is a Qivryn team member
 */
export function isQivrynTeamMember(email?: string): boolean {
  if (!email) return false;
  return email.includes("@qivryn.ai");
}
