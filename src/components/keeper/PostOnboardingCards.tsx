import { useEffect } from 'react';
import { Wallet, Building2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useHomeCards } from '@/hooks/useHomeCards';

interface PostOnboardingCardsProps {
  householdId: string | null;
  onOpenBudget: () => void;
  onOpenAccounts: () => void;
}

/**
 * Renders the dismissible "Set up your budget" / "Connect your accounts"
 * cards on the Dashboard for users who took escape hatches during
 * onboarding. Also fires the one-time welcome toast.
 */
export function PostOnboardingCards({
  householdId, onOpenBudget, onOpenAccounts,
}: PostOnboardingCardsProps) {
  const { state, loaded, update } = useHomeCards(householdId);

  // One-shot welcome toast.
  useEffect(() => {
    if (!loaded) return;
    if (!state.welcome_toast_shown) {
      toast('Welcome to Keeper.', {
        description: 'You can revisit setup anytime in Profile.',
      });
      update({ welcome_toast_shown: true });
    }
  }, [loaded, state.welcome_toast_shown, update]);

  if (!loaded) return null;

  const showBudget = state.needs_budget_setup && !state.budget_setup_dismissed;
  const showPlaid = state.needs_plaid_setup && !state.plaid_setup_dismissed;

  if (!showBudget && !showPlaid) return null;

  return (
    <div className="px-6 mt-4 space-y-3">
      {showBudget && (
        <SetupCard
          icon={Wallet}
          title="Set up your budget"
          description="Pick up where you left off — add the buckets that matter to your household."
          actionLabel="Open Budget"
          onAction={onOpenBudget}
          onDismiss={() => update({ budget_setup_dismissed: true })}
          accent="accent"
        />
      )}
      {showPlaid && (
        <SetupCard
          icon={Building2}
          title="Connect your accounts"
          description="Link a bank to pull transactions automatically — no more manual entry."
          actionLabel="Connect"
          onAction={onOpenAccounts}
          onDismiss={() => update({ plaid_setup_dismissed: true })}
          accent="primary"
        />
      )}
    </div>
  );
}

function SetupCard({
  icon: Icon, title, description, actionLabel, onAction, onDismiss, accent,
}: {
  icon: typeof Wallet;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
  accent: 'accent' | 'primary';
}) {
  const bg = accent === 'accent' ? 'bg-accent/10 border-accent/30' : 'bg-primary/5 border-primary/20';
  const iconBg = accent === 'accent' ? 'bg-accent/20 text-accent' : 'bg-primary/10 text-primary';
  const linkColor = accent === 'accent' ? 'text-accent' : 'text-primary';

  return (
    <div className={`rounded-xl border p-4 flex gap-3 items-start ${bg} animate-fade-up`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground leading-snug mt-0.5">{description}</p>
        <button
          onClick={onAction}
          className={`text-sm font-semibold mt-2 active:scale-95 transition ${linkColor}`}
        >
          {actionLabel} →
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="text-muted-foreground/60 hover:text-foreground shrink-0"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}
