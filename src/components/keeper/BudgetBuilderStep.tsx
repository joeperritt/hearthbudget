import { useMemo, useState } from 'react';
import {
  Wallet, ChevronRight, HelpCircle, AlertTriangle, Plus, Trash2, Check,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import { CFP_BUCKETS, type CfpBucket } from '@/lib/cfpBuckets';
import { supabase } from '@/integrations/supabase/client';

/* ---------- Types ---------- */

export type BucketCategoryDraft = {
  /** Local-only id for keying. */
  id: string;
  name: string;
  amount: string;
  /** variable → budget_categories; fixed → fixed_expenses */
  kind: 'variable' | 'fixed';
  notes_required: boolean;
};

/* ---------- Smart defaults: which kind to suggest per bucket ---------- */
const DEFAULT_KIND_BY_BUCKET: Record<string, 'variable' | 'fixed'> = {
  // Variable defaults
  groceries: 'variable',
  eating_out: 'variable',
  transportation: 'variable',
  lifestyle: 'variable',
  kids: 'variable',
  pets: 'variable',
  medical: 'variable',
  travel: 'variable',
  // Fixed defaults
  housing: 'fixed',
  insurance: 'fixed',
  non_housing_debt: 'fixed',
  giving: 'fixed',
  saving: 'fixed',
};

function defaultKindFor(bucket: CfpBucket): 'variable' | 'fixed' {
  return DEFAULT_KIND_BY_BUCKET[bucket.key] ?? bucket.role;
}

/* ---------- Bucket → fixed-expense group routing ---------- */
function fixedGroupForBucket(bucketKey: string): 'bills' | 'savings' | 'tithe' {
  if (bucketKey === 'giving') return 'tithe';
  if (bucketKey === 'saving') return 'savings';
  return 'bills';
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function newDraftId() {
  return Math.random().toString(36).slice(2, 10);
}

/* ============================================================
 * Persistence helper — writes drafts to budget_categories /
 * fixed_expenses + category_bucket_map. Reused by both the
 * onboarding flow and the standalone budget-builder sheet.
 * ============================================================ */
export async function persistBudgetDrafts(
  householdId: string,
  drafts: Record<string, BucketCategoryDraft[]>,
) {
  const variableRows: any[] = [];
  const fixedRows: any[] = [];
  const mappings: any[] = [];
  let sortOrder = 0;

  for (const [bucketKey, list] of Object.entries(drafts)) {
    for (const d of list) {
      const amt = Number(d.amount);
      const trimmedName = d.name.trim();
      if (!trimmedName || isNaN(amt) || amt <= 0) continue;

      // Slug must be unique-ish; suffix with random to avoid collisions.
      const slug = `${slugify(trimmedName)}-${newDraftId()}`.slice(0, 60);

      if (d.kind === 'variable') {
        variableRows.push({
          household_id: householdId,
          slug,
          name: trimmedName,
          budgeted: amt,
          group: 'shared',
          sort_order: sortOrder,
          notes_required: d.notes_required,
        });
      } else {
        fixedRows.push({
          household_id: householdId,
          slug,
          name: trimmedName,
          amount: amt,
          group: fixedGroupForBucket(bucketKey),
          sort_order: sortOrder,
          notes_required: d.notes_required,
        });
      }
      mappings.push({
        household_id: householdId,
        category_slug: slug,
        bucket_key: bucketKey,
        category_kind: d.kind,
      });
      sortOrder += 1;
    }
  }

  if (variableRows.length > 0) {
    await supabase.from('budget_categories').insert(variableRows as any);
  }
  if (fixedRows.length > 0) {
    await supabase.from('fixed_expenses').insert(fixedRows as any);
  }
  if (mappings.length > 0) {
    await supabase
      .from('category_bucket_map')
      .upsert(mappings as any, { onConflict: 'household_id,category_slug' });
  }
}

/* ============================================================
 * Step 5 — Budget builder
 * Each bucket card hosts multiple category drafts.
 * ============================================================ */
interface BudgetBuilderStepProps {
  buckets: CfpBucket[];
  drafts: Record<string, BucketCategoryDraft[]>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, BucketCategoryDraft[]>>>;
  monthlyTakeHome: number;
  totalAllocated: number;
  onSkipEntirely?: () => void;
  onComplete: () => void;
  /** Header label for the primary action button. */
  continueLabel?: string;
  /** Optional title override (used by standalone sheet). */
  title?: string;
  /** Optional intro override. */
  intro?: string;
  /** Hide the "I'll set this up later" escape (e.g. when reopened from Budget tab). */
  hideSkip?: boolean;
}

export function BudgetBuilderStep({
  buckets, drafts, setDrafts,
  monthlyTakeHome, totalAllocated,
  onSkipEntirely, onComplete,
  continueLabel = 'Continue',
  title = 'Build your starter budget',
  intro = "Add the categories you want to track under each bucket. You can add as many as you want — and skip the buckets that don't apply.",
  hideSkip = false,
}: BudgetBuilderStepProps) {
  const allocPct = monthlyTakeHome > 0 ? (totalAllocated / monthlyTakeHome) * 100 : 0;
  const remaining = monthlyTakeHome - totalAllocated;
  const overAllocated = totalAllocated > monthlyTakeHome;

  const updateBucketDrafts = (bucketKey: string, next: BucketCategoryDraft[]) => {
    setDrafts(prev => ({ ...prev, [bucketKey]: next }));
  };

  return (
    <>
      <div>
        <div className="w-14 h-14 rounded-2xl bg-accent/15 flex items-center justify-center mb-5">
          <Wallet size={28} className="text-accent" />
        </div>
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          {intro}
        </p>

        {/* Bucket cards */}
        <div className="mt-6 space-y-3">
          {buckets.map(b => (
            <BucketCard
              key={b.key}
              bucket={b}
              drafts={drafts[b.key] ?? []}
              setDrafts={(next) => updateBucketDrafts(b.key, next)}
              monthlyTakeHome={monthlyTakeHome}
            />
          ))}
        </div>
      </div>

      {/* Sticky footer with running total + Continue */}
      <div className="fixed bottom-0 inset-x-0 z-20 bg-background/95 backdrop-blur border-t border-border shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)] safe-bottom">
        <div className="max-w-xl mx-auto px-6 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Allocated
            </p>
            <p className="text-[11px] font-semibold text-muted-foreground tabular-nums">
              {Math.round(allocPct)}%
            </p>
          </div>
          <p className="text-base font-display font-bold text-foreground tabular-nums leading-tight mt-0.5">
            {formatCurrency(totalAllocated)}
            <span className="text-xs font-medium text-muted-foreground"> of {formatCurrency(monthlyTakeHome)} take-home</span>
          </p>
          <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                overAllocated ? 'bg-destructive' : 'bg-accent'
              }`}
              style={{ width: `${Math.min(allocPct, 100)}%` }}
            />
          </div>
          {overAllocated ? (
            <div className="mt-1.5 flex items-start gap-1 text-[11px] text-destructive font-medium">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              <span>You've allocated more than your take-home.</span>
            </div>
          ) : remaining > 0 && totalAllocated > 0 ? (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {formatCurrency(remaining)} left to allocate
            </p>
          ) : null}

          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={onComplete}
              className="flex-1 bg-primary text-primary-foreground font-semibold py-2.5 rounded-xl active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2 text-sm"
            >
              {continueLabel} <ChevronRight size={16} />
            </button>
          </div>
          {!hideSkip && onSkipEntirely && (
            <button
              onClick={onSkipEntirely}
              className="block w-full text-[11px] text-muted-foreground font-medium hover:text-foreground py-1.5 mt-1 active:scale-95 transition"
            >
              I'll set this up later
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- Per-bucket card with multi-category list ---------- */
function BucketCard({
  bucket, drafts, setDrafts, monthlyTakeHome,
}: {
  bucket: CfpBucket;
  drafts: BucketCategoryDraft[];
  setDrafts: (next: BucketCategoryDraft[]) => void;
  monthlyTakeHome: number;
}) {
  const [adding, setAdding] = useState(false);

  const isMin = bucket.guideline_kind === 'min';
  const guidelineDollar = monthlyTakeHome > 0
    ? Math.round((monthlyTakeHome * bucket.guideline_pct) / 100)
    : 0;
  const recommendation = isMin
    ? `Recommended: at least ${bucket.guideline_pct}% of take-home`
    : `Recommended: no more than ${bucket.guideline_pct}% of take-home`;

  const subtotal = useMemo(
    () => drafts.reduce((s, d) => s + (Number(d.amount) || 0), 0),
    [drafts],
  );
  const subtotalPct = monthlyTakeHome > 0 ? (subtotal / monthlyTakeHome) * 100 : 0;

  const addCategory = (draft: Omit<BucketCategoryDraft, 'id'>) => {
    setDrafts([...drafts, { ...draft, id: newDraftId() }]);
    setAdding(false);
  };

  const removeCategory = (id: string) => {
    setDrafts(drafts.filter(d => d.id !== id));
  };

  return (
    <div className="bg-card rounded-xl shadow-sm p-4 border border-border/60">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{bucket.label}</p>
          <p className="text-xs text-muted-foreground leading-snug mt-0.5">{bucket.description}</p>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <p className="text-[11px] text-muted-foreground">
          {recommendation}
          {monthlyTakeHome > 0 && (
            <> · ~{formatCurrency(guidelineDollar)}/mo</>
          )}
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-accent font-medium hover:underline active:scale-95 transition"
              aria-label={`Why ${bucket.guideline_pct}%?`}
            >
              <HelpCircle size={11} />
              Why this number?
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
            {bucket.guideline_source}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Category rows */}
      {drafts.length > 0 && (
        <ul className="mt-3 space-y-1">
          {drafts.map(d => (
            <li key={d.id} className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{d.name}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {d.kind}{d.notes_required ? ' · notes required' : ''}
                </p>
              </div>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {formatCurrency(Number(d.amount) || 0)}
              </p>
              <button
                type="button"
                onClick={() => removeCategory(d.id)}
                className="p-1.5 text-muted-foreground/70 hover:text-destructive active:scale-90 transition"
                aria-label={`Remove ${d.name}`}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Subtotal */}
      {drafts.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/60 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Subtotal
          </p>
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {formatCurrency(subtotal)}
            {monthlyTakeHome > 0 && (
              <span className="text-[11px] font-medium text-muted-foreground ml-1.5">
                ({subtotalPct.toFixed(1)}%)
              </span>
            )}
          </p>
        </div>
      )}

      {/* Add form / button */}
      {adding ? (
        <AddCategoryForm
          defaultKind={defaultKindFor(bucket)}
          onCancel={() => setAdding(false)}
          onAdd={addCategory}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium text-accent border border-dashed border-accent/50 rounded-lg py-2 active:scale-[0.98] transition hover:bg-accent/5"
        >
          <Plus size={13} />
          Add category
        </button>
      )}
    </div>
  );
}

/* ---------- Inline add-category form ---------- */
function AddCategoryForm({
  defaultKind, onCancel, onAdd,
}: {
  defaultKind: 'variable' | 'fixed';
  onCancel: () => void;
  onAdd: (draft: Omit<BucketCategoryDraft, 'id'>) => void;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'variable' | 'fixed'>(defaultKind);
  const [notesRequired, setNotesRequired] = useState(false);

  const canSave = name.trim().length > 0 && Number(amount) > 0;

  const save = () => {
    if (!canSave) return;
    onAdd({ name: name.trim(), amount, kind, notes_required: notesRequired });
  };

  return (
    <div className="mt-3 bg-muted/40 rounded-lg p-3 space-y-3 border border-border/60">
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Category name
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          placeholder="e.g. Gas, Auto Insurance"
          className="w-full text-sm font-medium text-foreground bg-card border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
        />
      </div>
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Monthly amount
        </label>
        <div className="flex items-center gap-1 bg-card border border-border rounded-md px-2.5 py-1.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30">
          <span className="text-sm text-muted-foreground">$</span>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0"
            className="flex-1 text-sm font-medium text-foreground bg-transparent outline-none tabular-nums"
          />
          <span className="text-[11px] text-muted-foreground">/ mo</span>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-card rounded-md p-1 border border-border">
        <button
          type="button"
          onClick={() => setKind('variable')}
          className={`flex-1 text-xs font-medium py-1.5 rounded transition ${
            kind === 'variable'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Variable
        </button>
        <button
          type="button"
          onClick={() => setKind('fixed')}
          className={`flex-1 text-xs font-medium py-1.5 rounded transition ${
            kind === 'fixed'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Fixed
        </button>
      </div>

      <div className="flex items-center justify-between bg-card rounded-md px-2.5 py-1.5 border border-border">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">Notes required</p>
          <p className="text-[10px] text-muted-foreground leading-tight">
            Force a note when entering transactions for this category.
          </p>
        </div>
        <Switch checked={notesRequired} onCheckedChange={setNotesRequired} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 text-xs font-medium text-muted-foreground py-2 rounded-lg hover:text-foreground active:scale-[0.98] transition"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="flex-1 text-xs font-semibold py-2 rounded-lg bg-accent text-accent-foreground active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1"
        >
          <Check size={13} /> Add
        </button>
      </div>
    </div>
  );
}
