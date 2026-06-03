"use client";

import { useState } from "react";

export default function DebugPage() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const testChat = async () => {
    setOutput("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: input,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setError(`Status ${response.status}: ${JSON.stringify(errorData)}`);
        setLoading(false);
        return;
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        setError("No response body");
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const json = JSON.parse(line.substring(6));
              console.log("Received:", json);

              if (json.type === "text-delta") {
                fullText += json.text;
                setOutput(fullText);
              } else if (json.type === "finish") {
                console.log("Stream finished");
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">DARSI Debug Chat</h1>

      <div className="space-y-4">
        <div>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && testChat()}
            placeholder="Type your message..."
            className="w-full p-2 border rounded"
          />
        </div>

        <button
          onClick={testChat}
          disabled={loading || !input}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          {loading ? "Sending..." : "Send"}
        </button>

        {error && (
          <div className="p-4 bg-red-100 text-red-700 rounded">
            <strong>Error:</strong> {error}
          </div>
        )}

        {output && (
          <div className="p-4 bg-gray-100 rounded whitespace-pre-wrap">
            <strong>Response:</strong>
            <br />
            {output}
          </div>
        )}
      </div>

      <div className="mt-8 space-y-2 text-sm text-gray-600">
        <p>
          <strong>Test Case 1:</strong> "Halo, selamat pagi" → Should return
          greeting only
        </p>
        <p>
          <strong>Test Case 2:</strong> "Kamu siapa? Data dari mana?" → Should
          return identity explanation
        </p>
        <p>
          <strong>Test Case 3:</strong> "Panggang sosis enak pakai bumbu apa
          ya?" → Should reject
        </p>
      </div>
    </div>
  );
}
