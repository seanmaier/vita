export interface Experience {
  title: string;
  company: string;
  companyNote?: string;
  dates: string;
  bullets: string[];
}

export interface Project {
  id: string;
  name: string;
  stack: string;
  description: string;
  link?: string;
  linkLabel?: string;
  hackathonLabel?: string;
}

export interface Education {
  degree: string;
  school: string;
  schoolDetail?: string;
  dates: string;
}

export interface SkillGroup {
  label: string;
  skills: string[];
  variant?: 'default' | 'learning';
}

export interface HumanLanguage {
  name: string;
  level: string;
}

export interface Profile {
  name: string;
  role: string;
  email: string;
  website: string;
  github: string;
  linkedin: string;
  city: string;
  summary: string;
  experience: Experience[];
  projects: Project[];
  education: Education;
  skillGroups: SkillGroup[];
  languages: HumanLanguage[];
  interests: string[];
}

export type ApplicationStatus =
  | 'drafting'
  | 'ready'
  | 'sent'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'ghosted'
  | 'withdrawn'
  | 'accepted'
  | 'declined'
  /** A checked job (see /stellencheck) without a decision yet. */
  | 'evaluated'
  /** A checked job the user decided not to apply to. */
  | 'skipped';

/** What /stellencheck recommends for a job. */
export type FitRecommendation = 'apply' | 'apply-if' | 'unlikely' | 'exclude';

/** How well a job fits, as rated by /stellencheck against the user's priorities. */
export interface JobFit {
  /** 0–100, the computed fit. */
  score: number;
  /** 0–100, the fit after a cap from the priorities; the score that counts when set. */
  cappedScore?: number;
  recommendation: FitRecommendation;
  /** The main reason in one sentence (for "apply-if", including the condition). */
  reason: string;
  /** ISO timestamp of the check. */
  evaluatedAt: string;
  /** How each criterion from the priorities was rated; missing for checks made before it was stored. */
  criteria?: FitCriterion[];
  /** The exclusion criterion that applied, if any. */
  exclusion?: string;
}

/** One criterion of a job check: its weight at the time and how far the job fulfils it. */
export interface FitCriterion {
  /** Verbatim from the criteria table in the priorities. */
  name: string;
  /** Integer 0–100; the weights of one check add up to 100. */
  weight: number;
  /** Integer 0–100, % fulfilled (50 when the posting doesn't say). */
  fulfilled: number;
}

/** A status that is recorded in an application's history; "ghosted" is only ever derived (see shared/domain/statusMachine.ts). */
export type StoredStatus = Exclude<ApplicationStatus, 'ghosted'>;

/** One step in an application's status history (kv key `status-history-<id>`), oldest first. */
export interface StatusTransition {
  to: StoredStatus;
  /** When it happened, "YYYY-MM-DD"; may be backdated. Null only for steps migrated from data without that date. */
  date: string | null;
  /** When it was entered (ISO timestamp); null for migrated steps. */
  recordedAt: string | null;
}

export interface CoverLetter {
  recipientOrg: string;
  recipientName?: string;
  date: string;
  subjectRole: string;
  paragraphs: string[];
  /** Closing line above the signature; falls back to the language default (see DEFAULT_CLOSINGS). */
  closing?: string;
}

export type AppLanguage = 'en' | 'de' | 'sv';
export type AppFont = 'sans' | 'serif' | 'mono';

export interface Note {
  id: string;
  text: string;
  /** ISO timestamp set when the note was created; absent for notes carried over from the old single free-text field. */
  createdAt?: string;
}

// A named, reusable profile a user can maintain independently of any single
// application — e.g. "Backend (EN)" vs "Frontend (DE)" — so applying for
// different kinds of roles no longer means overwriting the one base profile.
export interface BaseProfile {
  id: string;
  name: string;
  language: AppLanguage;
  profile: Profile;
  /**
   * Set (ISO timestamp) when the profile is moved to the trash. It's hidden
   * from pickers and lists but still renders for applications that use it,
   * until the server purges it after TRASH_RETENTION_DAYS.
   */
  deletedAt?: string;
}

export interface ApplicationConfig {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  language?: AppLanguage;
  font?: AppFont;
  appliedDate?: string;
  interviewDate?: string;
  finalDecisionDate?: string;
  notes?: Note[];
  url?: string;
  baseProfileId?: string;
  summaryOverride?: string;
  featuredProjectIds?: string[];
  skillGroupsOverride?: SkillGroup[];
  coverLetter?: CoverLetter;
  /** The job check's result, if the job was checked. */
  fit?: JobFit;
  /**
   * Set (ISO timestamp) on the stored entry when the application is moved to
   * the trash; the server purges it after TRASH_RETENTION_DAYS.
   */
  deletedAt?: string;
}

export type JobLeadSource = 'linkedin' | 'stepstone' | 'indeed' | 'glassdoor' | 'instaffo' | 'arbeitsagentur' | 'other';
export type JobLeadStatus = 'new' | 'rated' | 'dismissed' | 'applied';

export interface JobLeadInput {
  source: JobLeadSource;
  externalId: string;
  title: string;
  company?: string;
  location?: string;
  /** What the alert says about the job beyond title, company and location (salary, work model, age). */
  snippet?: string;
  url: string;
}

/** Whether a rating rests on the posting's text or only on title, company and location. */
export type RatingBasis = 'read' | 'estimated';

export interface JobLead extends JobLeadInput {
  id: number;
  receivedAt: string;
  status: JobLeadStatus;
  score: number | null;
  verdict: string | null;
  ratedAt: string | null;
  applicationId: string | null;
  /** How the rating breaks down per criterion; missing for leads rated without it. */
  criteria?: FitCriterion[];
  /** The exclusion criterion that applied, if any. */
  exclusion?: string;
  /** What the rating rests on; missing for leads rated before it was recorded. */
  basis?: RatingBasis;
}

export interface InboundEvent {
  id: number;
  kind: 'confirmation' | 'failed' | 'leads';
  receivedAt: string;
  subject: string | null;
  sender: string | null;
  detail: string | null;
}

export interface JobAlertsConfig {
  /** False when the server has no INBOUND_DOMAIN, i.e. job alerts are off. */
  available: boolean;
  address: string | null;
  forwardingFrom: string | null;
}
