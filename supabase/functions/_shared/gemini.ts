// Shared helper for calling Gemini directly via Google AI Studio API.
// Translates OpenAI-style messages → Gemini contents/systemInstruction format.

export type ChatMessage = { role: string; content: string };

export interface GeminiCallOptions {
  model?: string;
  messages: ChatMessage[];
  apiKey: string;
}

export interface GeminiResult {
  ok: boolean;
  status: number;
  content?: string;
  errorBody?: string;
}

export async function callGemini({
  model = "gemini-2.5-flash",
  messages,
  apiKey,
}: GeminiCallOptions): Promise<GeminiResult> {
  // Separate system messages from conversational turns
  const systemParts: string[] = [];
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      });
    }
  }

  const body: Record<string, unknown> = { contents };
  if (systemParts.length > 0) {
    body.systemInstruction = { parts: [{ text: systemParts.join("\n\n") }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    return { ok: false, status: response.status, errorBody };
  }

  const data = await response.json();
  const content =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text || "")
      .join("") || "";

  return { ok: true, status: 200, content };
}
