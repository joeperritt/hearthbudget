import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AskAIChatSheet, AskAIButton } from './AskAIChatSheet';

interface ContextualAskAIProps {
  /** Short label shown in the sheet header. */
  contextLabel: string;
  /** Multi-line description prepended to the user's first message so the model
   *  knows what page/data the user is asking about. */
  contextPreface: string;
  /** Optional system prompt override. Defaults to the generic CFP persona. */
  systemPrompt?: string;
  /** Optional pill label override. */
  buttonLabel?: string;
  /** Optional alignment / wrapper classes for the button. */
  className?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are a Certified Financial Planner (CFP®) and Certified Kingdom Advisor (CKA) helping a household inside their personal finance app called Keeper. Be warm, direct, and practical. When the user provides context about which page they are looking at, ground every answer in that data — quote specific dollar amounts, percentages, and item names from the context when relevant. Avoid generic financial platitudes. Keep responses concise (2-4 short paragraphs unless the question demands more) and use plain English. Do NOT use markdown bolding stars (**text**) — write naturally. Do NOT recommend hiring a different advisor unless the question is clearly outside the scope of household budgeting / planning.`;

/**
 * Drop-in "Ask AI anything" pill + sheet. Each insight surface (Plan tools,
 * Budget Analyzer) wires its own context label + preface so the chat opens
 * already grounded in what the user is looking at.
 */
export function ContextualAskAI({
  contextLabel, contextPreface, systemPrompt = DEFAULT_SYSTEM_PROMPT,
  buttonLabel, className,
}: ContextualAskAIProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => setMessages([]), []);

  const sendMessage = useCallback(async (msg: string) => {
    const userMsg = { role: 'user' as const, content: msg };
    const next = [...messages, userMsg];
    setMessages(next);
    setLoading(true);
    try {
      // Edge function multi-turn requires a budgetSummary; for freeform contextual
      // chat we collapse the conversation into the `prompt` one-shot input and
      // pass our own systemPrompt + the page context as preface text.
      const transcript = next
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');
      const fullPrompt = `Context (the page the user is currently looking at):\n${contextPreface}\n\nConversation so far:\n${transcript}\n\nReply as the assistant. Do not prefix with "Assistant:".`;

      const { data, error } = await supabase.functions.invoke('budget-insights', {
        body: { prompt: fullPrompt, systemPrompt, stewardshipMode: true },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const reply = data?.content ?? data?.reply ?? "Sorry — I couldn't generate a response.";
      setMessages(m => [...m, { role: 'assistant', content: String(reply) }]);
    } catch (e: any) {
      setMessages(m => [...m, { role: 'assistant', content: `Couldn't reach the AI: ${e?.message || 'unknown error'}.` }]);
    } finally {
      setLoading(false);
    }
  }, [messages, systemPrompt, contextPreface]);

  return (
    <>
      <div className={className ?? 'mt-3 flex justify-center'}>
        <AskAIButton
          onClick={() => { reset(); setOpen(true); }}
          label={buttonLabel ?? `Ask AI about ${contextLabel.toLowerCase()}`}
        />
      </div>
      <AskAIChatSheet
        open={open}
        onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}
        contextLabel={contextLabel}
        contextPreface={contextPreface}
        chatMessages={messages}
        chatLoading={loading}
        onSendMessage={sendMessage}
      />
    </>
  );
}
