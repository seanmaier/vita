// Copy of JobLeadSource / JobLeadInput from the app's shared/types.ts (the
// worker is a standalone project and cannot import from the app). Keep in sync.
export type JobLeadSource = 'linkedin' | 'stepstone' | 'indeed' | 'glassdoor' | 'instaffo' | 'arbeitsagentur' | 'other';

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
