import { useEffect, useState } from "react";

const UI_TEXT = {
  en: {
    welcome: "Hi! Ask me about rooms, policies, or amenities.",
    thinking: "Thinking...",
    placeholder: "Type your question...",
    error: "Sorry, I could not respond just now."
  }
};

const BURMESE_CHAR_REGEX = /[\u1000-\u109F]/;

function detectLanguage(value) {
  return BURMESE_CHAR_REGEX.test(value || "") ? "my" : "en";
}


function KnowledgeBasePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const kbLang = new URLSearchParams(window.location.search).get("lang") === "my" ? "my" : "en";

  useEffect(() => {
    document.documentElement.lang = kbLang;
    document.body.classList.toggle("lang-my", kbLang === "my");
  }, [kbLang]);

  useEffect(() => {
    let cancelled = false;

    async function loadKb() {
      try {
        const res = await fetch(`/api/kb?lang=${kbLang}`);
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.error || "Request failed");
        }
        if (!cancelled) {
          setData(body);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Could not load the knowledge base.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadKb();
    return () => {
      cancelled = true;
    };
  }, []);

  const identity = data?.hotel_identity || {};
  const contact = identity.contact || {};
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  const facilities = Array.isArray(data?.facilities) ? data.facilities : [];
  const dining = Array.isArray(data?.dining) ? data.dining : [];
  const policies = data?.policies || {};
  const eventVenues = Array.isArray(data?.event_venues) ? data.event_venues : [];
  const transportation = data?.transportation || {};
  const airport = transportation.airport_shuttle || {};
  const parking = transportation.parking || {};
  const digital = data?.digital_services || {};
  const wifi = digital.wifi || {};
  const reviews = data?.reviews || {};
  const reviewCategories = reviews.categories || {};

  function formatList(items) {
    if (!Array.isArray(items) || items.length === 0) return "N/A";
    return items.join(", ");
  }

  function formatBool(value) {
    return value ? "Yes" : "No";
  }

  return (
    <div className="kb">
      <header className="kb-header">
        <div>
          <h1>{identity.name || "Knowledge Base"}</h1>
          <p>{identity.description || "Current hotel data used by the assistant."}</p>
        </div>
        <div className="kb-badges">
          <div className="kb-badge">Rating {identity.rating || "N/A"}</div>
          <div className="kb-badge">{identity.stars || "N/A"} Stars</div>
        </div>
      </header>

      {loading && <div className="kb-card">Loading...</div>}
      {error && <div className="kb-card kb-error">{error}</div>}

      {!loading && !error && (
        <div className="kb-grid">
          <section className="kb-card kb-identity">
            <h2>Hotel Identity</h2>
            <div className="kb-field"><span>Brand</span><strong>{identity.brand || "N/A"}</strong></div>
            <div className="kb-field"><span>Address</span><strong>{identity.address || "N/A"}</strong></div>
            <div className="kb-field"><span>Nearby</span><strong>{formatList(identity.nearby_landmarks)}</strong></div>
            <div className="kb-field"><span>Languages</span><strong>{formatList(identity.languages_spoken)}</strong></div>
            <div className="kb-field"><span>Built</span><strong>{identity.year_built || "N/A"}</strong></div>
            <div className="kb-field"><span>Renovated</span><strong>{identity.last_renovated || "N/A"}</strong></div>
            <div className="kb-field"><span>Coordinates</span><strong>{identity.geo ? `${identity.geo.latitude}, ${identity.geo.longitude}` : "N/A"}</strong></div>

            <div className="kb-divider" />
            <h3>Contact</h3>
            <div className="kb-field"><span>Phone</span><strong>{contact.phone || "N/A"}</strong></div>
            <div className="kb-field"><span>Email</span><strong>{contact.email || "N/A"}</strong></div>
            <div className="kb-field"><span>Website</span><strong>{contact.website || "N/A"}</strong></div>
            <div className="kb-field"><span>WhatsApp</span><strong>{contact.whatsapp || "N/A"}</strong></div>
          </section>

          <section className="kb-card">
            <h2>Rooms</h2>
            <p className="kb-meta">{rooms.length} types</p>
            <div className="kb-list">
              {rooms.map((room) => (
                <div key={room.id || room.type} className="kb-item">
                  <div className="kb-item-title">{room.type}</div>
                  <div className="kb-item-body">
                    Bed: {room.bed} | Capacity: {room.capacity} | Size: {room.size_sqm} sqm<br />
                    View: {room.view} | Floors: {formatList(room.floor_options)}<br />
                    Smoking: {formatBool(room.smoking)} | Accessible: {formatBool(room.accessible)}<br />
                    Available: {room.available_rooms}/{room.total_rooms}
                  </div>
                  <div className="kb-tags">Amenities: {formatList(room.amenities)}</div>
                  <div className="kb-pricing">
                    Base ${room.pricing?.base_price_usd} | Weekend ${room.pricing?.weekend_price_usd} | High ${room.pricing?.high_season_price_usd}
                    <span>Tax {room.pricing?.tax_percent}% + Service {room.pricing?.service_charge_percent}%</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="kb-card">
            <h2>Facilities</h2>
            <div className="kb-list">
              {facilities.map((facility) => (
                <div key={facility.name} className="kb-item">
                  <div className="kb-item-title">{facility.name}</div>
                  <div className="kb-item-body">Hours: {facility.hours}</div>
                  <div className="kb-tags">Location: {facility.location} | Access: {facility.access}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="kb-card">
            <h2>Dining</h2>
            <div className="kb-list">
              {dining.map((venue) => (
                <div key={venue.name} className="kb-item">
                  <div className="kb-item-title">{venue.name}</div>
                  <div className="kb-item-body">{venue.cuisine} | {venue.type}</div>
                  <div className="kb-tags">Hours: {venue.hours} | Breakfast included: {formatBool(venue.breakfast_included)}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="kb-card">
            <h2>Policies</h2>
            <div className="kb-list">
              <div className="kb-item">
                <div className="kb-item-title">Check-in / Check-out</div>
                <div className="kb-item-body">Check-in: {policies.check_in} | Check-out: {policies.check_out}</div>
                <div className="kb-tags">Early: {policies.early_check_in} | Late: {policies.late_check_out}</div>
              </div>
              <div className="kb-item">
                <div className="kb-item-title">Cancellation & Payment</div>
                <div className="kb-item-body">Free until: {policies.cancellation?.free_until_hours} hours</div>
                <div className="kb-tags">Late fee: {policies.cancellation?.late_cancellation_fee} | Methods: {formatList(policies.payment?.methods)} | Deposit: {formatBool(policies.payment?.deposit_required)}</div>
              </div>
              <div className="kb-item">
                <div className="kb-item-title">Other</div>
                <div className="kb-item-body">Children: {policies.children}</div>
                <div className="kb-tags">Extra bed: ${policies.extra_bed_usd} | Pets: {policies.pets} | Smoking: {policies.smoking}</div>
                <div className="kb-tags">ID: {policies.id_requirement}</div>
              </div>
            </div>
          </section>

          <section className="kb-card">
            <h2>Event Venues</h2>
            <div className="kb-list">
              {eventVenues.map((venue) => (
                <div key={venue.name} className="kb-item">
                  <div className="kb-item-title">{venue.name}</div>
                  <div className="kb-item-body">{venue.type} | Capacity: {venue.capacity}</div>
                  <div className="kb-tags">Layouts: {formatList(venue.layouts)} | Equipment: {formatList(venue.equipment)}</div>
                  <div className="kb-tags">Catering: {formatBool(venue.catering_available)} | Full day ${venue.pricing?.full_day_usd} | Half day ${venue.pricing?.half_day_usd} | Hourly ${venue.pricing?.hourly_usd}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="kb-card">
            <h2>Transportation</h2>
            <div className="kb-list">
              <div className="kb-item">
                <div className="kb-item-title">Airport Shuttle</div>
                <div className="kb-item-body">Available: {formatBool(airport.available)} | Price: ${airport.price_usd}</div>
                <div className="kb-tags">Schedule: {airport.schedule}</div>
              </div>
              <div className="kb-item">
                <div className="kb-item-title">Parking & Rentals</div>
                <div className="kb-item-body">Parking: {parking.type} ({parking.price})</div>
                <div className="kb-tags">Car rental: {formatBool(transportation.car_rental)} | Nearby: {formatList(transportation.nearby_transport)}</div>
              </div>
            </div>
          </section>

          <section className="kb-card">
            <h2>Digital Services</h2>
            <div className="kb-list">
              <div className="kb-item">
                <div className="kb-item-title">WiFi</div>
                <div className="kb-item-body">Available: {formatBool(wifi.available)} | Free: {formatBool(wifi.free)}</div>
                <div className="kb-tags">Speed: {wifi.speed}</div>
              </div>
              <div className="kb-item">
                <div className="kb-item-title">Check-in & Contact</div>
                <div className="kb-item-body">Mobile check-in: {formatBool(digital.mobile_check_in)}</div>
                <div className="kb-tags">Channels: {formatList(digital.contact_channels)}</div>
              </div>
            </div>
          </section>

          <section className="kb-card">
            <h2>Reviews</h2>
            <div className="kb-item">
              <div className="kb-item-title">Overall</div>
              <div className="kb-item-body">Average rating {reviews.average_rating} from {reviews.total_reviews} reviews</div>
              <div className="kb-tags">Cleanliness {reviewCategories.cleanliness} | Service {reviewCategories.service} | Location {reviewCategories.location} | Value {reviewCategories.value}</div>
            </div>
            <div className="kb-item">
              <div className="kb-item-title">Sample Reviews</div>
              <div className="kb-item-body">{formatList(reviews.sample_reviews)}</div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function App() {
  const isKbPage = window.location.pathname === "/kb";
  if (isKbPage) {
    return <KnowledgeBasePage />;
  }

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
