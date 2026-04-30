import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import ReactMarkdown from 'react-markdown';

export interface AskAIChatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Short label shown in the header indicating what context the AI has. */
  contextLabel: string;
  /** Optional extra context string appended (visibly) to the user's first message so the AI knows what the user is looking at. */
  contextPreface?: string;
  chatMessages: { role: 'user' | 'assistant'; content: string }[];
  chatLoading: boolean;
  onSendMessage: (msg: string) => void;
  /** Optional placeholder for the input field. */
  placeholder?: string;
}

/**
 * Reusable bottom sheet that wraps the existing AI chat. Used everywhere insights
 * are surfaced (Home, Plan tools, Budget Analyzer) so conversations are contextual
 * instead of starting from a blank slate.
 */
export function AskAIChatSheet({
  open, onOpenChange, contextLabel, contextPreface,
  chatMessages, chatLoading, onSendMessage,
  placeholder = 'Ask anything about your budget or plan…',
}: AskAIChatSheetProps) {
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, open]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg) return;
    setInput('');
    // Prefix the context once on the first send so the model knows what the user is looking at.
    const isFirst = chatMessages.length === 0;
    const payload = isFirst && contextPreface
      ? `Context: ${contextPreface}\n\nQuestion: ${msg}`
      : msg;
    onSendMessage(payload);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] flex flex-col p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border text-left">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <SheetTitle className="text-base">Ask AI</SheetTitle>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Context: {contextLabel}</p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {chatMessages.length === 0 && (
            <div className="bg-card rounded-lg p-4 text-sm text-muted-foreground">
              Ask anything about your budget, this month's spending, or your plan.
              The AI already has your latest budget data.
            </div>
          )}
          {chatMessages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                m.role === 'user'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'mr-auto bg-card text-foreground shadow-sm'
              }`}
            >
              {m.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
            </div>
          ))}
          {chatLoading && (
            <div className="mr-auto bg-card rounded-2xl px-3.5 py-2.5 shadow-sm flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-accent" />
              <span className="text-xs text-muted-foreground">Thinking…</span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="px-4 py-3 border-t border-border bg-background">
          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={placeholder}
              disabled={chatLoading}
              className="flex-1"
            />
            <button
              onClick={handleSend}
              disabled={chatLoading || !input.trim()}
              className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface AskAIButtonProps {
  onClick: () => void;
  label?: string;
  className?: string;
}

/** Small pill button used in insight cards to open the AskAIChatSheet. */
export function AskAIButton({ onClick, label = 'Ask AI anything about your budget or plan', className = '' }: AskAIButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 text-accent text-xs font-semibold active:scale-[0.98] transition-transform hover:bg-accent/15 ${className}`}
    >
      <Sparkles size={13} />
      <span>{label}</span>
    </button>
  );
}
