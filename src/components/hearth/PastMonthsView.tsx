import { ArrowLeft, Inbox } from 'lucide-react';

interface PastMonthsViewProps {
  onBack: () => void;
}

export function PastMonthsView({ onBack }: PastMonthsViewProps) {
  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top">
        <button onClick={onBack} className="flex items-center gap-1 text-accent text-sm font-medium mb-4 active:scale-95 transition-transform">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl font-bold text-foreground">Past Months</h1>
        <p className="text-sm text-muted-foreground mt-1">Previous budget & transaction history</p>
      </div>

      <div className="px-6 mt-8">
        <div className="bg-card rounded-lg shadow-sm px-4 py-10 flex flex-col items-center justify-center">
          <Inbox size={28} className="text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground font-medium">No past months yet</p>
          <p className="text-[11px] text-muted-foreground/60 mt-1 text-center">
            Completed months will appear here after you start a new month in Settings
          </p>
        </div>
      </div>
    </div>
  );
}
