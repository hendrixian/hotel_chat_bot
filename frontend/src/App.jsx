import { useEffect, useState } from "react";

const UI_TEXT = {
  en: {
    welcome: "Hi! Ask me about rooms, policies, or amenities.",
    thinking: "Thinking...",
    placeholder: "Type your question...",
    error: "Sorry, I could not respond just now."
  }
};

const BURMESE_CHAR_REGEX = /[က-႟]/;

function detectLanguage(value) {
  return BURMESE_CHAR_REGEX.test(value || "") ? "my" : "en";
}

function App() {
  const [uiText, setUiText] = useState(UI_TEXT.en);
  const [messages, setMessages] = useState([{ role: "assistant", content: UI_TEXT.en.welcome }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uiLanguage, setUiLanguage] = useState("my");
  const [sessionId, setSessionId] = useState(() => localStorage.getItem("sessionId") || "");

  useEffect(() => {
    document.documentElement.lang = uiLanguage === "my" ? "my" : "en";
    document.body.classList.toggle("lang-my", uiLanguage === "my");
  }, [uiLanguage]);

  useEffect(() => {
    if (!input.trim()) return;
    const detected = detectLanguage(input);
    if (detected !== uiLanguage) {
      setUiLanguage(detected);
    }
  }, [input, uiLanguage]);

  useEffect(() => {
    let cancelled = false;

    async function loadUiText() {
      if (uiLanguage !== "my") {
        setUiText(UI_TEXT.en);
        setMessages((prev) => {
          if (prev.length === 1 && prev[0].role === "assistant") {
            return [{ role: "assistant", content: UI_TEXT.en.welcome }];
          }
          return prev;
        });
        return;
      }

      try {
        const res = await fetch("/api/translate-ui", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetLang: "my",
            texts: [
              UI_TEXT.en.welcome,
              UI_TEXT.en.thinking,
              UI_TEXT.en.placeholder,
              UI_TEXT.en.error
            ]
          })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Request failed");
        }
        if (!Array.isArray(data.texts) || data.texts.length !== 4) {
          throw new Error("Invalid translation response");
        }

        if (cancelled) return;
        const translated = {
          welcome: data.texts[0],
          thinking: data.texts[1],
          placeholder: data.texts[2],
          error: data.texts[3]
        };
        setUiText(translated);
        setMessages((prev) => {
          if (prev.length === 1 && prev[0].role === "assistant") {
            return [{ role: "assistant", content: translated.welcome }];
          }
          return prev;
        });
      } catch (err) {
        if (!cancelled) {
          setUiText(UI_TEXT.en);
        }
      }
    }

    loadUiText();
    return () => {
      cancelled = true;
    };
  }, [uiLanguage]);

  async function sendMessage() {
    const text = input.trim();
    const messageLang = detectLanguage(text);
    if (!text || loading) return;

    setLoading(true);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId, language: messageLang })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }

      if (data.sessionId && data.sessionId !== sessionId) {
        setSessionId(data.sessionId);
        localStorage.setItem("sessionId", data.sessionId);
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: messageLang === "my" ? uiText.error : UI_TEXT.en.error
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Hotel Chat Assistant</h1>
          <p>Hybrid LLM routing with retrieval</p>
        </div>
      </header>

      <main className="chat">
        {messages.map((msg, idx) => (
          <div key={idx} className={`bubble ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {loading && (
          <div className="bubble assistant">
            {uiLanguage === "my" ? uiText.thinking : UI_TEXT.en.thinking}
          </div>
        )}
      </main>

      <footer className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={uiLanguage === "my" ? uiText.placeholder : UI_TEXT.en.placeholder}
          rows={2}
        />
        <button onClick={sendMessage} disabled={loading}>
          Send
        </button>
      </footer>
    </div>
  );
}

export default App;
