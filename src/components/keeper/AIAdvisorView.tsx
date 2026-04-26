import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Sparkles, Send } from 'lucide-react';
import { Insight } from '@/hooks/useBudgetInsights';
import { Input } from '@/components/ui/input';
import ReactMarkdown from 'react-markdown';
import { BigPictureSection } from './BigPictureSection';

interface AIAdvisorViewProps {
  bigPictureInsights: Insight[];
  bigPictureLoading: boolean;
  bigPictureError: string | null;
  bigPictureLastUpdated: Date | null;
  bigPictureHasCached: boolean;
  onGenerateBigPicture: () => void;
  chatMessages: { role: 'user' | 'assistant'; content: string }[];
  chatLoading: boolean;
  onSendMessage: (msg: string) => void;
  onBack: () => void;
}

export function AIAdvisorView({
  bigPictureInsights,
  bigPictureLoading,
  bigPictureError,
  bigPictureLastUpdated,
  bigPictureHasCached,
  onGenerateBigPicture,
  chatMessages,
  chatLoading,
  onSendMessage,
  onBack,
}: AIAdvisorViewProps) {
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg) return;
    setInput('');
    onSendMessage(msg);
  };

  return (
    <div className="max-w-lg mx-auto flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-12 pb-4 safe-top">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-8 h-8 rounded-full bg-card flex items-center justify-center active:scale-95">
            <ArrowLeft size={18} className="text-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-accent" />
            <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">AI Advisor</h1>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <BigPictureSection
          insights={bigPictureInsights}
          loading={bigPictureLoading}
          error={bigPictureError}
          lastUpdated={bigPictureLastUpdated}
          hasCached={bigPictureHasCached}
          onGenerate={onGenerateBigPicture}
        />

        {/* Chat messages */}
        {chatMessages.length > 0 && (
          <div className="space-y-3 mb-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Conversation</h3>
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3.5 py-2.5 ${
                  msg.role === 'user'
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-card shadow-sm border border-border'
                }`}>
                  {msg.role === 'assistant' ? (
                    <div className="text-sm text-foreground prose prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-card shadow-sm border border-border rounded-lg px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Chat input */}
      <div className="px-6 py-3 border-t border-border bg-background safe-bottom">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask Keeper about your budget or plan..."
            className="flex-1 text-sm"
            disabled={chatLoading}
          />
          <button
            onClick={handleSend}
            disabled={chatLoading || !input.trim()}
            className="w-10 h-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
