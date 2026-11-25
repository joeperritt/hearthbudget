import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReactNode } from 'react';

export function SubHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div className="px-6 pt-12 safe-top flex items-center gap-3">
      <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back" className="-ml-2 text-muted-foreground"><ArrowLeft size={20} /></Button>
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground flex-1">{title}</h1>
      {right}
    </div>
  );
}

export function YearSelect({ years, value, onChange }: { years: number[]; value: number; onChange: (y: number) => void }) {
  return (
    <select aria-label="Year" value={value} onChange={e => onChange(Number(e.target.value))} className="h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground">
      {years.map(y => <option key={y} value={y}>{y}</option>)}
    </select>
  );
}
