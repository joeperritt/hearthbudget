import { ArrowLeft, Home, BarChart3, Car, FileText, PiggyBank, Lock, Info, Target, Activity } from 'lucide-react';

type ToolId = 'mortgage' | 'debt-payoff' | 'car-loan' | 'tax-withholding' | 'retirement' | 'goals-planner' | 'cfp-profile' | 'health-score';

interface FinancialToolsViewProps {
  onBack: () => void;
  onSelectTool: (tool: ToolId) => void;
}

const tools: { id: ToolId; name: string; description: string; icon: typeof Home; active: boolean }[] = [
  { id: 'health-score', name: 'Health Score', description: 'Your overall financial health at a glance', icon: Activity, active: true },
  { id: 'mortgage', name: 'Mortgage Calculator', description: 'How much home can you afford?', icon: Home, active: true },
  { id: 'debt-payoff', name: 'Debt Payoff', description: 'See your path to debt freedom', icon: BarChart3, active: true },
  { id: 'car-loan', name: 'Car Loan', description: 'Calculate your true cost of ownership', icon: Car, active: true },
  { id: 'tax-withholding', name: 'Tax Withholding', description: 'Optimize your W-4 withholding', icon: FileText, active: true },
  { id: 'retirement', name: 'Retirement Planner', description: 'Are you on track to retire?', icon: PiggyBank, active: true },
  { id: 'goals-planner', name: 'Savings Goals', description: 'Track and plan your savings goals', icon: Target, active: true },
];

export function FinancialToolsView({ onBack, onSelectTool }: FinancialToolsViewProps) {
  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Financial Tools</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Calculators powered by your real data</p>
        </div>
      </div>

      {/* Tool Cards Grid */}
      <div className="px-6 mt-6 grid grid-cols-2 gap-3">
        {tools.map(tool => (
          <button
            key={tool.id}
            onClick={() => tool.active ? onSelectTool(tool.id) : undefined}
            className={`relative flex flex-col items-start gap-3 bg-card rounded-xl p-4 shadow-sm text-left transition-transform ${
              tool.active ? 'active:scale-[0.97]' : 'opacity-70'
            }`}
          >
            {!tool.active && (
              <span className="absolute top-2.5 right-2.5 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                <Lock size={10} /> Soon
              </span>
            )}
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              tool.active ? 'bg-primary/10' : 'bg-muted'
            }`}>
              <tool.icon size={20} className={tool.active ? 'text-primary' : 'text-muted-foreground'} />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">{tool.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{tool.description}</p>
            </div>
          </button>
        ))}
      </div>
      {/* Disclaimer */}
      <div className="px-6 mt-6 mb-24 flex gap-2">
        <Info size={14} className="text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          These tools provide general financial estimates powered by AI and standard planning guidelines. Results are for educational purposes only and may not reflect your complete financial picture. For personalized advice, consult a Certified Financial Planner (CFP®) professional or CPA.
        </p>
      </div>
    </div>
  );
}
