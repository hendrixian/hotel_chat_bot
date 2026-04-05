import { useEffect, useState } from "react";

const WELCOME = {
  en: "Hi! Ask me about rooms, policies, or amenities.",
  my: "မင်္ဂလာပါ! အခန်းတွေ၊ မူဝါဒတွေ၊ ဝန်ဆောင်မှုများအကြောင်း မေးနိုင်ပါတယ်။"
};


function App() {
  const [messages, setMessages] = useState([{ role: "assistant", content: WELCOME.en }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState("en");
  const [sessionId, setSessionId] = useState(() => localStorage.getItem("sessionId") || "");

  useEffect(() => {
    setMessages([{ role: "assistant", content: WELCOME[language] }]);
  }, [language]);

  useEffect(() => {
    document.documentElement.lang = language === "my" ? "my" : "en";
    document.body.classList.toggle("lang-my", language === "my");
  }, [language]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId, language })
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
          content: language === "my"
              ? "ယခုအချိန်တွင် ပြန်ကြားမပေးနိုင်ပါ။"
              : "Sorry, I could not respond just now."

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
        <div className="toggle">
          <button
            className={language === "en" ? "active" : ""}
            onClick={() => setLanguage("en")}
          >
            English
          </button>
          <button
            className={language === "my" ? "active" : ""}
            onClick={() => setLanguage("my")}
          >
            Burmese
          </button>
        </div>
      </header>

      <main className="chat">
        {messages.map((msg, idx) => (
          <div key={idx} className={`bubble ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {loading && <div className="bubble assistant">Thinking...</div>}
      </main>

      <footer className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={language === "my" ? "မေးခွန်းရေးပါ..." : "Type your question..."}
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
