import { useEffect, useState } from 'react';

const FLAG_KEY = 'keeper.lastAuthMethod';
const DISMISS_KEY = 'keeper.recoveryBannerDismissed';

interface RecoveryFlag {
  method: string;
  remaining: number;
  at: number;
}

export function RecoveryCodeBanner({ onOpenSecurity }: { onOpenSecurity?: () => void }) {
  const [flag, setFlag] = useState<RecoveryFlag | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FLAG_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as RecoveryFlag;
      if (parsed?.method === 'recovery_code') setFlag(parsed);
    } catch {
      // ignore
    }
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  if (!flag || dismissed) return null;

  const low = flag.remaining <= 3;

  return (
    <div
      className={`px-4 py-3 text-sm flex items-start gap-3 ${
        low
          ? 'bg-destructive/10 border-b border-destructive/20 text-destructive'
          : 'bg-accent/10 border-b border-accent/20 text-foreground'
      }`}
    >
      <div className="flex-1">
        {low ? (
          <p>
            <span className="font-semibold">Only {flag.remaining} recovery codes left.</span>{' '}
            <button
              onClick={onOpenSecurity}
              className="underline font-medium"
            >
              Regenerate now
            </button>{' '}
            to stay protected.
          </p>
        ) : (
          <p>
            You signed in with a recovery code. You have{' '}
            <span className="font-semibold">{flag.remaining}</span> remaining.{' '}
            If you lost your authenticator,{' '}
            <button onClick={onOpenSecurity} className="underline font-medium">
              set up a new one
            </button>
            . Otherwise no action needed.
          </p>
        )}
      </div>
      <button
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
        className="text-xs opacity-60 hover:opacity-100"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
