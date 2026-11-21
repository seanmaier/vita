import type { ApplicationConfig, CoverLetter } from '#shared/types.ts';
import { useProfiles } from '../api/profiles';
import { resolveApplicationProfile } from '../utils/baseProfiles';
import { QueryState } from './QueryState';
import { CVDocument } from './cv/CVDocument';
import { CoverLetterDocument } from './cover-letter/CoverLetterDocument';

interface Props {
  config: ApplicationConfig;
}

/** Renders the actual CV/cover-letter documents a config would produce, for confirming an import before applying it. */
export function ApplicationConfigPreview({ config }: Props) {
  return (
    <QueryState query={useProfiles()}>
      {({ baseProfiles, languages }) => {
        const profile = resolveApplicationProfile(config, baseProfiles, languages);
        return (
          <div className="py-8 px-5">
            <CVDocument profile={profile} application={config} />
            {config.coverLetter && (
              <CoverLetterDocument
                profile={profile}
                application={{ ...config, coverLetter: config.coverLetter as CoverLetter }}
                paginate
              />
            )}
          </div>
        );
      }}
    </QueryState>
  );
}
