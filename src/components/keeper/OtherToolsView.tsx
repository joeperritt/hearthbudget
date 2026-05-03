import { ArrowLeft, BarChart3, Calculator, ChevronRight } from 'lucide-react';

interface Props {
  onBack: () => void;
  onSelect: (target: 'calculators' | 'trends') => void;
}

export function OtherToolsView({ onBack, onSelect }: Props) {
  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full active:bg-muted transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Other Tools</h1>
          <p className="text-xs text-muted-foreground">Calculators and spending trends</p>
        </div>
      </div>

      <div className="px-6 mt-6 space-y-3">
        <Tile
          icon={Calculator}
          title="Calculators"
          subtitle="Generic financial calculators"
          onClick={() => onSelect('calculators')}
        />
        <Tile
          icon={BarChart3}
          title="Trends"
          subtitle="Month over month spending comparison"
          onClick={() => onSelect('trends')}
        />
      </div>
    </div>
  );
}

function Tile({
  icon: Icon, title, subtitle, onClick,
}: {
  icon: typeof Calculator;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 bg-card rounded-xl p-4 shadow-sm text-left active:scale-[0.98] transition-transform border-l-4 border-border"
    >
      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-primary/10 text-primary">
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
      </div>
      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
    </button>
  );
}
