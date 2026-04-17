import { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

export type SchoolType = 'public_in_state' | 'public_out_state' | 'private';
export type DegreeType = '2-year' | '4-year';

export interface EducationDependent {
  name: string;
  /** Year the dependent turns 18 (used for inflation horizon) */
  yearTurns18: number;
  /** Current age, for display */
  currentAge?: number | null;
}

const COST_TABLE: Record<SchoolType, Record<DegreeType, number>> = {
  public_in_state:  { '4-year': 25000, '2-year': 12000 },
  public_out_state: { '4-year': 45000, '2-year': 25000 },
  private:          { '4-year': 58000, '2-year': 30000 },
};

const SCHOOL_LABELS: Record<SchoolType, string> = {
  public_in_state: 'Public In-State',
  public_out_state: 'Public Out-of-State',
  private: 'Private',
};

const DEFAULT_INFLATION_PCT = 5; // 5% annual education inflation

interface EducationCostEstimatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Available dependents to target (used for inflation horizon) */
  dependents?: EducationDependent[];
  /** Pre-select a dependent by name */
  initialDependentName?: string | null;
  /** Show a manual "years until needed" input when no dependent is chosen */
  allowManualYears?: boolean;
  /** Called with the inflation-adjusted total + dependent name + targetYear */
  onApply: (result: { total: number; dependentName: string | null; targetYear: number }) => void;
  applyButtonLabel?: string;
}

export function EducationCostEstimator({
  open,
  onOpenChange,
  dependents = [],
  initialDependentName = null,
  allowManualYears = true,
  onApply,
  applyButtonLabel = 'Use this estimate',
}: EducationCostEstimatorProps) {
  const [schoolType, setSchoolType] = useState<SchoolType>('public_in_state');
  const [degreeType, setDegreeType] = useState<DegreeType>('4-year');
  const [dependentName, setDependentName] = useState<string | null>(initialDependentName);
  const [manualYears, setManualYears] = useState<string>('18');

  useEffect(() => {
    if (open) {
      setDependentName(initialDependentName ?? (dependents[0]?.name ?? null));
    }
  }, [open, initialDependentName]);

  const annualCost = COST_TABLE[schoolType][degreeType];
  const years = degreeType === '4-year' ? 4 : 2;
  const currentTotal = annualCost * years;

  const currentYear = new Date().getFullYear();
  const selectedDep = dependents.find(d => d.name === dependentName) || null;

  const targetYear = useMemo(() => {
    if (selectedDep) return selectedDep.yearTurns18;
    const yrs = Math.max(0, parseInt(manualYears) || 0);
    return currentYear + yrs;
  }, [selectedDep, manualYears, currentYear]);

  const yearsToTarget = Math.max(0, targetYear - currentYear);
  const inflationFactor = Math.pow(1 + INFLATION_RATE, yearsToTarget);
  const inflatedTotal = currentTotal * inflationFactor;

  const handleApply = () => {
    onApply({
      total: Math.round(inflatedTotal),
      dependentName: selectedDep?.name ?? null,
      targetYear,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Education Cost Estimator</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* School Type */}
          <div>
            <Label className="text-xs text-muted-foreground">School Type</Label>
            <div className="grid grid-cols-3 gap-1.5 mt-1.5">
              {(Object.keys(SCHOOL_LABELS) as SchoolType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSchoolType(t)}
                  className={`text-[11px] font-semibold py-1.5 rounded-full transition-colors ${
                    schoolType === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {SCHOOL_LABELS[t].replace('Public ', 'Pub. ')}
                </button>
              ))}
            </div>
          </div>

          {/* Degree */}
          <div>
            <Label className="text-xs text-muted-foreground">Degree Type</Label>
            <div className="grid grid-cols-2 gap-1.5 mt-1.5">
              {(['2-year', '4-year'] as DegreeType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDegreeType(t)}
                  className={`text-xs font-semibold py-1.5 rounded-full transition-colors ${
                    degreeType === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {t === '2-year' ? '2-Year' : '4-Year'}
                </button>
              ))}
            </div>
          </div>

          {/* Dependent selector */}
          {dependents.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground">For Which Dependent?</Label>
              <div className="grid gap-1.5 mt-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(dependents.length, 3)}, minmax(0, 1fr))` }}>
                {dependents.map(d => (
                  <button
                    key={d.name}
                    type="button"
                    onClick={() => setDependentName(d.name)}
                    className={`text-[11px] font-semibold py-1.5 px-2 rounded-full transition-colors truncate ${
                      dependentName === d.name ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {d.name}{typeof d.currentAge === 'number' ? ` (${d.currentAge})` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Manual years fallback */}
          {!selectedDep && allowManualYears && (
            <div>
              <Label className="text-xs text-muted-foreground">Years Until Needed</Label>
              <Input
                type="number"
                className="mt-1"
                min="0"
                value={manualYears}
                onChange={e => setManualYears(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>
          )}

          {/* Cost summary */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Annual Cost (today)</span>
              <span className="font-semibold text-foreground tabular-nums">{fmt(annualCost)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total ({years} years)</span>
              <span className="font-semibold text-foreground tabular-nums">{fmt(currentTotal)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-border pt-1.5">
              <span className="text-muted-foreground">Inflation-Adjusted Total</span>
              <span className="font-bold text-accent tabular-nums">{fmt(inflatedTotal)}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Using 5% annual education inflation through {targetYear}
              {selectedDep ? ` (when ${selectedDep.name} turns 18)` : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={handleApply}
            className="w-full py-2.5 bg-accent text-accent-foreground rounded-xl font-semibold text-sm active:opacity-90"
          >
            {applyButtonLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
