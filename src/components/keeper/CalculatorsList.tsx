import { ArrowLeft, Home, Car, FileText, Calculator } from 'lucide-react';

type CalculatorId = 'mortgage-shopping' | 'car-loan' | 'tax-estimator';

interface CalculatorsListProps {
  onBack: () => void;
  onSelectCalculator: (calc: CalculatorId) => void;
}

const calculators: { id: CalculatorId; name: string; subtitle: string; icon: typeof Home }[] = [
  { id: 'mortgage-shopping', name: 'Mortgage Calculator', subtitle: 'How much home can you afford?', icon: Home },
  { id: 'car-loan', name: 'Car Loan Calculator', subtitle: 'Calculate your true cost of ownership', icon: Car },
  { id: 'tax-estimator', name: 'Federal Tax Estimator', subtitle: 'Estimate your federal tax liability', icon: FileText },
];

export function CalculatorsList({ onBack, onSelectCalculator }: CalculatorsListProps) {
  return (
    <div className="max-w-lg mx-auto pb-32">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Calculators</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Generic financial calculators</p>
        </div>
      </div>

      <div className="px-6 mt-4 space-y-2 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-4">
        {calculators.map(calc => (
          <button
            key={calc.id}
            onClick={() => onSelectCalculator(calc.id)}
            className="w-full flex items-center gap-3 bg-card rounded-xl p-3.5 shadow-sm text-left active:scale-[0.98] transition-transform"
          >
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <calc.icon size={18} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground leading-tight">{calc.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug truncate">{calc.subtitle}</p>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap bg-muted text-muted-foreground">
              Calculator
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
