export type ProfileTab = 'profile' | 'income' | 'housing' | 'debts' | 'accounts' | 'insurance';
export type PlanToolId =
  | 'emergency-fund'
  | 'savings-goals'
  | 'retirement'
  | 'mortgage-analyzer'
  | 'debt-payoff'
  | 'life-insurance';

export interface AINavigationHandlers {
  onNavigateToProfile?: (tab?: ProfileTab) => void;
  onNavigateToPlanTool?: (toolId: PlanToolId) => void;
  onNavigateToBudget?: () => void;
}

interface ParsedDestination {
  kind: 'profile' | 'plan-tool' | 'budget';
  profileTab?: ProfileTab;
  toolId?: PlanToolId;
}

const PROFILE_TAB_MAP: Record<string, ProfileTab> = {
  accounts: 'accounts',
  insurance: 'insurance',
  housing: 'housing',
  debts: 'debts',
  profile: 'profile',
  income: 'income',
};

const PLAN_TOOL_MAP: Record<string, PlanToolId> = {
  'emergency fund analysis': 'emergency-fund',
  'non-retirement goals': 'savings-goals',
  'retirement planner': 'retirement',
  'mortgage analyzer': 'mortgage-analyzer',
  'debt payoff analyzer': 'debt-payoff',
  'life insurance analysis': 'life-insurance',
};

export function parseDestination(destination: string): ParsedDestination | null {
  if (!destination) return null;
  const normalized = destination.trim().toLowerCase();

  if (normalized === 'budget') return { kind: 'budget' };

  // Financial Profile > <tab>
  const profileMatch = normalized.match(/financial profile\s*>\s*(\w+)/);
  if (profileMatch) {
    const tab = PROFILE_TAB_MAP[profileMatch[1]];
    if (tab) return { kind: 'profile', profileTab: tab };
  }

  // Plan > <tool>
  const planMatch = normalized.match(/plan\s*>\s*(.+)/);
  if (planMatch) {
    const toolKey = planMatch[1].trim();
    const toolId = PLAN_TOOL_MAP[toolKey];
    if (toolId) return { kind: 'plan-tool', toolId };
  }

  return null;
}

export function navigateToDestination(destination: string, handlers: AINavigationHandlers): boolean {
  const parsed = parseDestination(destination);
  if (!parsed) return false;

  if (parsed.kind === 'profile' && handlers.onNavigateToProfile) {
    handlers.onNavigateToProfile(parsed.profileTab);
    return true;
  }
  if (parsed.kind === 'plan-tool' && parsed.toolId && handlers.onNavigateToPlanTool) {
    handlers.onNavigateToPlanTool(parsed.toolId);
    return true;
  }
  if (parsed.kind === 'budget' && handlers.onNavigateToBudget) {
    handlers.onNavigateToBudget();
    return true;
  }
  return false;
}

export function canNavigateTo(destination: string, handlers: AINavigationHandlers): boolean {
  const parsed = parseDestination(destination);
  if (!parsed) return false;
  if (parsed.kind === 'profile') return !!handlers.onNavigateToProfile;
  if (parsed.kind === 'plan-tool') return !!handlers.onNavigateToPlanTool;
  if (parsed.kind === 'budget') return !!handlers.onNavigateToBudget;
  return false;
}
