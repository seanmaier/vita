// The job sites whose alert mails the mail worker can read, as shown on the
// account page. Mirrors SENDER_DOMAINS in workers/job-alerts/src/parsers.ts;
// jobAlertSources.test.ts fails when the two drift apart.

export interface JobAlertSource {
  label: string;
  /** Sender domains the alerts come from (subdomains count too). */
  domains: string[];
}

export const JOB_ALERT_SOURCES: JobAlertSource[] = [
  { label: 'LinkedIn', domains: ['linkedin.com'] },
  { label: 'StepStone', domains: ['stepstone.de'] },
  { label: 'Indeed', domains: ['indeed.com', 'indeed.de'] },
  { label: 'Glassdoor', domains: ['glassdoor.com', 'glassdoor.de'] },
  { label: 'Instaffo', domains: ['instaffo.com'] },
];
