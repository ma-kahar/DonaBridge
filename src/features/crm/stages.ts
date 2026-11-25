export const CONTACT_STAGES = [
  "new",
  "follow_up",
  "negotiating",
  "won",
  "do_not_contact",
] as const;

export type ContactStage = (typeof CONTACT_STAGES)[number];
