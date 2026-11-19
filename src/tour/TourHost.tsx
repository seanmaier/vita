import { useEffect, useState } from 'react';
import { Tour } from './Tour';
import { buildTourSteps } from './tourSteps';
import type { TourStep } from './tourSteps';
import { storage } from '../utils/storage';
import { useApplications } from '../api/applications';
import { isDemo } from '../demo/demoMode';
import { onStartTour } from './tourControl';
import { STORAGE_KEYS } from '#shared/storageKeys.ts';

// Stored with the user's data, so the tour opens once per account rather
// than once per device. In the demo that storage is the browser tab, so a
// reset or a language switch brings the tour back.
const SEEN_KEY = STORAGE_KEYS.tourSeen;

// The tour shows the first application on the dashboard.
const stepsFor = (firstId: string | undefined): TourStep[] => buildTourSteps(isDemo ? 'demo' : 'app', firstId);

interface Props {
  /** Shows a page (a path inside the app), if it isn't shown already. */
  navigate: (path: string) => void;
}

/** Owns when the tour is open: once by itself, then whenever startTour() is called. */
export function TourHost({ navigate }: Props) {
  const records = useApplications().data;
  const [open, setOpen] = useState(() => !storage.getItem(SEEN_KEY));
  // Bumped on every start, so a restart begins at step one even if the tour was open.
  const [run, setRun] = useState(0);

  useEffect(
    () =>
      onStartTour(() => {
        setOpen(true);
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
        storage.setItem(SEEN_KEY, '1');
        setOpen(false);
      }}
    />
  );
}
