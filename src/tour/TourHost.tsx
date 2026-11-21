import { useEffect, useState } from 'react';
import { Tour } from './Tour';
import { buildTourSteps } from './tourSteps';
import type { TourStep } from './tourSteps';
import { useApplications } from '../api/applications';
import { useMarkTourSeen, useSettings } from '../api/settings';
import { isDemo } from '../demo/demoMode';
import { onStartTour } from './tourControl';

// Whether it was closed is an account setting, so the tour opens once per
// account rather than once per device. In the demo that setting lives in the
// browser tab, so a reset or a language switch brings the tour back.

// The tour shows the first application on the dashboard.
const stepsFor = (firstId: string | undefined): TourStep[] => buildTourSteps(isDemo ? 'demo' : 'app', firstId);

interface Props {
  /** Shows a page (a path inside the app), if it isn't shown already. */
  navigate: (path: string) => void;
}

/** Owns when the tour is open: once by itself, then whenever startTour() is called. */
export function TourHost({ navigate }: Props) {
  const records = useApplications().data;
  const settings = useSettings().data;
  const markSeen = useMarkTourSeen();
  // Set by a start or a close; until then the tour opens by itself if it was never closed.
  const [shown, setShown] = useState<boolean | null>(null);
  const open = shown ?? (settings ? !settings.tourSeen : false);
  // Bumped on every start, so a restart begins at step one even if the tour was open.
  const [run, setRun] = useState(0);

  useEffect(
    () =>
      onStartTour(() => {
        setShown(true);
        setRun((r) => r + 1);
      }),
    [],
  );

  // Waits for the applications, so the tour can point at the first one.
  if (!open || !records) return null;
  return (
    <Tour
      key={run}
      steps={stepsFor(records.find((r) => !r.app.deletedAt)?.app.id)}
      navigate={navigate}
      onClose={() => {
        setShown(false);
        if (!settings?.tourSeen) markSeen.mutate();
      }}
    />
  );
}
