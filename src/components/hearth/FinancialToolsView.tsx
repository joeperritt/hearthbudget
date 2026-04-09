import { ArrowLeft, Home, BarChart3, Car, FileText, PiggyBank, Lock, Shield, ChevronRight } from 'lucide-react';

type ToolId = 'mortgage' | 'debt-payoff' | 'car-loan' | 'tax-withholding' | 'retirement' | 'cfp-profile';

interface FinancialToolsViewProps {
  onBack: () => void;
  onSelectTool: (tool: ToolId) => void;
}

const tools: { id: ToolId; name: string; description: string; icon: typeof Home; active: boolean }[] = [
  { id: 'mortgage', name: 'Mortgage Calculator', description: 'How much home can you afford?', icon: Home, active: true },
  { id: 'debt-payoff', name: 'Debt Payoff', description: 'See your path to debt freedom', icon: BarChart3, active: true },
  { id: 'car-loan', name: 'Car Loan', description: 'Calculate your true cost of ownership', icon: Car, active: false },
  { id: 'tax-withholding', name: 'Tax Withholding', description: 'Optimize your W-4 withholding', icon: FileText, active: false },
  { id: 'retirement', name: 'Retirement Planner', description: 'Are you on track to retire?', icon: PiggyBank, active: false },
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

      {/* Financial Profile CTA Banner */}
      <div className="px-6 mt-6">
        <button
          onClick={() => onSelectTool('cfp-profile')}
          className="w-full flex items-center gap-4 bg-primary rounded-xl p-4 shadow-md text-left active:scale-[0.98] transition-transform"
        >
          <div className="w-11 h-11 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
            <Shield size={22} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-accent">Financial Profile</p>
            <p className="text-xs text-primary-foreground/70 mt-0.5">Required for personalized insights</p>
          </div>
          <ChevronRight size={18} className="text-accent flex-shrink-0" />
        </button>
      </div>

      {/* Tool Cards Grid */}
      <div className="px-6 mt-4 grid grid-cols-2 gap-3">
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
    </div>
  );
}
