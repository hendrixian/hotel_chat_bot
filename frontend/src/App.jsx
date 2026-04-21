import { useEffect, useState } from "react";

const UI_TEXT = {
  en: {
    welcome: "Hi! You can ask about rooms, policies or anything you like.",
    thinking: "Please Wait...",
    placeholder: "Ask your question...",
    error: "Sorry, I could not respond just now."
  }
};

const ROOM_TYPE_OPTIONS = ["Standard Room", "Deluxe Room"];

const BURMESE_CHAR_REGEX = /[\u1000-\u109F]/;

function detectLanguage(value) {
  return BURMESE_CHAR_REGEX.test(value || "") ? "my" : "en";
}

function normalizeVenue(value) {
  const raw = String(value || "").trim();
  return raw === "[object Object]" ? "" : raw;
}


function KnowledgeBasePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [token] = useState(() => localStorage.getItem("adminToken") || "");

  const kbLang = new URLSearchParams(window.location.search).get("lang") === "my" ? "my" : "en";

  useEffect(() => {
    document.documentElement.lang = kbLang;
    document.body.classList.toggle("lang-my", kbLang === "my");
  }, [kbLang]);

  useEffect(() => {
    let cancelled = false;

    async function loadKb() {
      if (!token) {
        if (!cancelled) {
          setError("Admin login required. Please log in at /admin first.");
          setLoading(false);
        }
        return;
      }
      try {
        const res = await fetch(`/api/admin/kb?lang=${kbLang}`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
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
  }, [kbLang, token]);

  const identity = data?.hotel_identity || {};
  const contact = identity.contact || {};
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  const facilities = Array.isArray(data?.facilities) ? data.facilities : [];
  const dining = Array.isArray(data?.dining) ? data.dining : [];
  const policies = data?.policies || {};
  const eventVenues = Array.isArray(data?.event_venues) ? data.event_venues : [];
  const eventsCalendar = Array.isArray(data?.events_calendar) ? data.events_calendar : [];
  const inventoryCalendar = Array.isArray(data?.inventory_calendar) ? data.inventory_calendar : [];
  const adminKbEntries = Array.isArray(data?.admin_kb_entries) ? data.admin_kb_entries : [];
  const reservations = Array.isArray(data?.reservations) ? data.reservations : [];
  const transportation = data?.transportation || {};
  const airport = transportation.airport_shuttle || {};
  const parking = transportation.parking || {};
  const digital = data?.digital_services || {};
  const wifi = digital.wifi || {};
  const reviews = data?.reviews || {};
  const reviewCategories = reviews.categories || {};
  const todayIso = new Date().toISOString().slice(0, 10);
  const upcomingEvents = eventsCalendar.filter((event) => String(event.end_date || "") >= todayIso);
  const upcomingReservations = reservations.filter((row) => String(row.check_out_date || "") >= todayIso);

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

          <section className="kb-card">
            <h2>Upcoming Events</h2>
            <div className="kb-list">
              {upcomingEvents.length === 0 && <div className="kb-item-body">No upcoming events.</div>}
              {upcomingEvents.map((event) => (
                <div key={event.id} className="kb-item">
                  <div className="kb-item-title">{event.title || "Untitled event"}</div>
                  <div className="kb-item-body">{event.start_date} to {event.end_date}{normalizeVenue(event.venue) ? ` | venue: ${normalizeVenue(event.venue)}` : ""}</div>
                  <div className="kb-tags">{event.description || ""}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="kb-card">
            <h2>Inventory Calendar</h2>
            <div className="kb-list">
              {inventoryCalendar.length === 0 && <div className="kb-item-body">No inventory rows.</div>}
              {inventoryCalendar.map((row) => (
                <div key={row.id} className="kb-item">
                  <div className="kb-item-title">{row.room_type} | {row.date}</div>
                  <div className="kb-item-body">Available: {row.available_rooms}/{row.total_rooms}</div>
                  <div className="kb-tags">{row.price_usd ? `Price $${row.price_usd}` : "No price override"} {row.notes ? `| ${row.notes}` : ""}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="kb-card">
            <h2>Reservations</h2>
            <div className="kb-list">
              {upcomingReservations.length === 0 && <div className="kb-item-body">No upcoming reservations.</div>}
              {upcomingReservations.map((row) => (
                <div key={row.id} className="kb-item">
                  <div className="kb-item-title">{row.guest_name} | {row.room_type}</div>
                  <div className="kb-item-body">{row.check_in_date} to {row.check_out_date} | rooms: {row.room_count}</div>
                  <div className="kb-tags">Status: {row.status}{row.notes ? ` | ${row.notes}` : ""}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="kb-card">
            <h2>Custom KB Entries</h2>
            <div className="kb-list">
              {adminKbEntries.length === 0 && <div className="kb-item-body">No custom entries yet.</div>}
              {adminKbEntries.map((entry) => (
                <div key={entry.id} className="kb-item">
                  <div className="kb-item-title">{entry.key} <span className="kb-pill">{entry.category}</span></div>
                  <div className="kb-item-body">{entry.title}</div>
                  <div className="kb-tags">{entry.content}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function AdminPage() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(() => localStorage.getItem("adminToken") || "");
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const [inventory, setInventory] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventVenueOptions, setEventVenueOptions] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [kbEntries, setKbEntries] = useState([]);

  const [invForm, setInvForm] = useState({
    roomType: "",
    date: "",
    totalRooms: "",
    availableRooms: "",
    priceUsd: "",
    notes: ""
  });
  const [eventForm, setEventForm] = useState({
    sourceLang: "en",
    titleEn: "",
    titleMy: "",
    descriptionEn: "",
    descriptionMy: "",
    venue: "",
    startDate: "",
    endDate: ""
  });
  const [reservationForm, setReservationForm] = useState({
    guestName: "",
    contact: "",
    roomType: "",
    checkInDate: "",
    checkOutDate: "",
    roomCount: 1,
    status: "confirmed",
    notes: ""
  });
  const [kbForm, setKbForm] = useState({
    kbKey: "",
    category: "general",
    sourceLang: "en",
    titleEn: "",
    titleMy: "",
    contentEn: "",
    contentMy: "",
    tags: ""
  });

  async function adminFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (options.body !== undefined && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Request failed");
    }
    return data;
  }

  async function loadAdminData() {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [me, inv, ev, rs, kb, adminKb] = await Promise.all([
        adminFetch("/api/admin/me"),
        adminFetch("/api/admin/room-inventory"),
        adminFetch("/api/admin/events"),
        adminFetch("/api/admin/reservations"),
        adminFetch("/api/admin/kb-entries"),
        adminFetch("/api/admin/kb?lang=en")
      ]);
      const eventVenues = Array.isArray(adminKb?.event_venues)
        ? adminKb.event_venues.map((venue) => normalizeVenue(venue?.name)).filter(Boolean)
        : [];
      setUser(me.user || null);
      setInventory(inv.rows || []);
      setEvents((ev.rows || []).map((row) => ({ ...row, venue: normalizeVenue(row.venue) })));
      setEventVenueOptions(eventVenues);
      setReservations(rs.rows || []);
      setKbEntries(kb.rows || []);
    } catch (err) {
      setError(err.message || "Could not load admin data");
      setUser(null);
      setToken("");
      localStorage.removeItem("adminToken");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdminData();
  }, [token, refreshTick]);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const data = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Login failed");
        return body;
      });
      setToken(data.token || "");
      localStorage.setItem("adminToken", data.token || "");
      setPassword("");
      setNotice("Logged in.");
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await adminFetch("/api/admin/logout", { method: "POST" });
    } catch (err) {
      // ignore on logout
    }
    setUser(null);
    setToken("");
    localStorage.removeItem("adminToken");
    setNotice("Logged out.");
  }

  async function submitInventory(e) {
    e.preventDefault();
    setError("");
    try {
      await adminFetch("/api/admin/room-inventory", {
        method: "POST",
        body: JSON.stringify({
          roomType: invForm.roomType,
          date: invForm.date,
          totalRooms: Number(invForm.totalRooms),
          availableRooms: Number(invForm.availableRooms),
          priceUsd: invForm.priceUsd === "" ? null : Number(invForm.priceUsd),
          notes: invForm.notes
        })
      });
      setInvForm({ roomType: "", date: "", totalRooms: "", availableRooms: "", priceUsd: "", notes: "" });
      setNotice("Inventory saved.");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setError(err.message || "Failed to save inventory");
    }
  }

  async function editInventory(row) {
    const totalRooms = window.prompt("Total rooms", String(row.total_rooms));
    if (totalRooms === null) return;
    const availableRooms = window.prompt("Available rooms", String(row.available_rooms));
    if (availableRooms === null) return;
    const priceUsd = window.prompt("Price USD (optional)", row.price_usd ?? "");
    if (priceUsd === null) return;
    const notes = window.prompt("Notes", row.notes || "");
    if (notes === null) return;

    try {
      await adminFetch(`/api/admin/room-inventory/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({
          roomType: row.room_type,
          date: row.date,
          totalRooms: Number(totalRooms),
          availableRooms: Number(availableRooms),
          priceUsd: priceUsd === "" ? null : Number(priceUsd),
          notes
        })
      });
      setNotice("Inventory updated.");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setError(err.message || "Failed to update inventory");
    }
  }

  async function removeInventory(id) {
    if (!window.confirm("Delete this inventory row?")) return;
    try {
      await adminFetch(`/api/admin/room-inventory/${id}`, { method: "DELETE" });
      setNotice("Inventory deleted.");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setError(err.message || "Failed to delete inventory");
    }
  }

  async function submitEvent(e) {
    e.preventDefault();
    setError("");
    if (!normalizeVenue(eventForm.venue)) {
      setError("Please select an event venue.");
      return;
    }
    try {
      await adminFetch("/api/admin/events", {
        method: "POST",
        body: JSON.stringify(eventForm)
      });
      setEventForm({
        sourceLang: "en",
        titleEn: "",
        titleMy: "",
        descriptionEn: "",
        descriptionMy: "",
        venue: "",
        startDate: "",
        endDate: ""
      });
      setNotice("Event saved.");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setError(err.message || "Failed to save event");
    }
  }

  async function editEvent(row) {
    const venue = window.prompt("Venue", row.venue || "");
    if (venue === null) return;
    const titleEn = window.prompt("Title (English)", row.title_en || "");
    if (titleEn === null) return;
    const titleMy = window.prompt("Title (Myanmar)", row.title_my || "");
    if (titleMy === null) return;
    const descriptionEn = window.prompt("Description (English)", row.description_en || "");
    if (descriptionEn === null) return;
    const descriptionMy = window.prompt("Description (Myanmar)", row.description_my || "");
    if (descriptionMy === null) return;
    const startDate = window.prompt("Start date (YYYY-MM-DD)", row.start_date || "");
    if (startDate === null) return;
    const endDate = window.prompt("End date (YYYY-MM-DD)", row.end_date || "");
    if (endDate === null) return;

    try {
      await adminFetch(`/api/admin/events/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({ titleEn, titleMy, descriptionEn, descriptionMy, venue, startDate, endDate, sourceLang: "en" })
      });
      setNotice("Event updated.");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setError(err.message || "Failed to update event");
    }
  }

  async function removeEvent(id) {
    if (!window.confirm("Delete this event?")) return;
    try {
      await adminFetch(`/api/admin/events/${id}`, { method: "DELETE" });
      setNotice("Event deleted.");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setError(err.message || "Failed to delete event");
    }
  }

  async function submitReservation(e) {
    e.preventDefault();
    setError("");
    try {
      await adminFetch("/api/admin/reservations", {
        method: "POST",
        body: JSON.stringify({
          ...reservationForm,
          roomCount: Number(reservationForm.roomCount || 1)
        })
      });
      setReservationForm({
        guestName: "",
        contact: "",
        roomType: "",
        checkInDate: "",
        checkOutDate: "",
        roomCount: 1,
        status: "confirmed",
        notes: ""
      });
      setNotice("Reservation saved.");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setError(err.message || "Failed to save reservation");
    }
  }

  async function editReservation(row) {
    const status = window.prompt("Status (confirmed/pending/cancelled/completed)", row.status || "confirmed");
    if (status === null) return;
    const notes = window.prompt("Notes", row.notes || "");
    if (notes === null) return;
    try {
      await adminFetch(`/api/admin/reservations/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({
          guestName: row.guest_name,
          contact: row.contact,
          roomType: row.room_type,
          checkInDate: row.check_in_date,
          checkOutDate: row.check_out_date,
          roomCount: row.room_count,
          status,
          notes
        })
      });
      setNotice("Reservation updated.");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setError(err.message || "Failed to update reservation");
    }
  }

  async function removeReservation(id) {
    if (!window.confirm("Delete this reservation?")) return;
    try {
      await adminFetch(`/api/admin/reservations/${id}`, { method: "DELETE" });
      setNotice("Reservation deleted.");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setError(err.message || "Failed to delete reservation");
    }
  }

  async function submitKbEntry(e) {
    e.preventDefault();
    setError("");
    try {
      await adminFetch("/api/admin/kb-entries", {
        method: "POST",
        body: JSON.stringify({
          ...kbForm,
          tags: kbForm.tags
        })
      });
      setKbForm({
        kbKey: "",
        category: "general",
        sourceLang: "en",
        titleEn: "",
        titleMy: "",
        contentEn: "",
        contentMy: "",
        tags: ""
      });
      setNotice("KB entry saved.");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setError(err.message || "Failed to save KB entry");
    }
  }

  async function editKbEntry(row) {
    const titleEn = window.prompt("Title (English)", row.title_en || "");
    if (titleEn === null) return;
    const titleMy = window.prompt("Title (Myanmar)", row.title_my || "");
    if (titleMy === null) return;
    const contentEn = window.prompt("Content (English)", row.content_en || "");
    if (contentEn === null) return;
    const contentMy = window.prompt("Content (Myanmar)", row.content_my || "");
    if (contentMy === null) return;
    const tags = window.prompt("Tags (comma-separated)", Array.isArray(row.tags) ? row.tags.join(", ") : row.tags || "");
    if (tags === null) return;

    try {
      await adminFetch(`/api/admin/kb-entries/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({
          kbKey: row.kb_key,
          category: row.category,
          titleEn,
          titleMy,
          contentEn,
          contentMy,
          tags
        })
      });
      setNotice("KB entry updated.");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setError(err.message || "Failed to update KB entry");
    }
  }

  async function removeKbEntry(id) {
    if (!window.confirm("Delete this KB entry?")) return;
    try {
      await adminFetch(`/api/admin/kb-entries/${id}`, { method: "DELETE" });
      setNotice("KB entry deleted.");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setError(err.message || "Failed to delete KB entry");
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div>
          <h1>Admin Console</h1>
          <p>Manage inventory, events, reservations, and KB in one place.</p>
        </div>
        {user && (
          <div className="admin-session">
            <span>Signed in as {user.username}</span>
            <a href="/admin/kb">Open Admin KB</a>
            <button onClick={handleLogout}>Logout</button>
          </div>
        )}
      </header>

      {error && <div className="admin-alert admin-error">{error}</div>}
      {notice && <div className="admin-alert admin-notice">{notice}</div>}

      {!token && (
        <form className="admin-card admin-form" onSubmit={handleLogin}>
          <h2>Admin Login</h2>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          <button type="submit" disabled={loading}>Login</button>
        </form>
      )}

      {token && (
        <div className="admin-grid">
          <section className="admin-card">
            <h2>Room Inventory</h2>
            <form className="admin-form compact" onSubmit={submitInventory}>
              <select value={invForm.roomType} onChange={(e) => setInvForm({ ...invForm, roomType: e.target.value })} required>
                <option value="">Room type</option>
                {ROOM_TYPE_OPTIONS.map((roomType) => (
                  <option key={roomType} value={roomType}>{roomType}</option>
                ))}
              </select>
              <input type="date" value={invForm.date} onChange={(e) => setInvForm({ ...invForm, date: e.target.value })} required />
              <input type="number" value={invForm.totalRooms} onChange={(e) => setInvForm({ ...invForm, totalRooms: e.target.value })} placeholder="Total rooms" required />
              <input type="number" value={invForm.availableRooms} onChange={(e) => setInvForm({ ...invForm, availableRooms: e.target.value })} placeholder="Available rooms" required />
              <input type="number" value={invForm.priceUsd} onChange={(e) => setInvForm({ ...invForm, priceUsd: e.target.value })} placeholder="Price USD" />
              <input value={invForm.notes} onChange={(e) => setInvForm({ ...invForm, notes: e.target.value })} placeholder="Notes" />
              <button type="submit">Save Inventory</button>
            </form>
            <div className="admin-list">
              {inventory.map((row) => (
                <div key={row.id} className="admin-item">
                  <div><strong>{row.room_type}</strong> | {row.date}</div>
                  <div>{row.available_rooms}/{row.total_rooms} available {row.price_usd ? `| $${row.price_usd}` : ""}</div>
                  <div className="admin-item-actions">
                    <button onClick={() => editInventory(row)}>Edit</button>
                    <button onClick={() => removeInventory(row.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="kb-card">
            <h2>Events Calendar</h2>
            <div className="kb-list">
              {events.length === 0 && <div className="kb-item-body">No events yet.</div>}
              {events.map((event) => (
                <div key={event.id} className="kb-item">
                  <div className="kb-item-title">{event.title_en || event.title_my || "Untitled event"}</div>
                  <div className="kb-item-body">{event.start_date} to {event.end_date}{normalizeVenue(event.venue) ? ` | venue: ${normalizeVenue(event.venue)}` : ""}</div>
                  <div className="kb-tags">{event.description_en || event.description_my || ""}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="kb-card">
            <h2>Inventory Calendar</h2>
            <div className="kb-list">
              {inventory.length === 0 && <div className="kb-item-body">No inventory rows yet.</div>}
              {inventory.map((row) => (
                <div key={row.id} className="kb-item">
                  <div className="kb-item-title">{row.room_type} | {row.date}</div>
                  <div className="kb-item-body">Available: {row.available_rooms}/{row.total_rooms}</div>
                  <div className="kb-tags">{row.price_usd ? `Price $${row.price_usd}` : "No price override"} {row.notes ? `| ${row.notes}` : ""}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="kb-card">
            <h2>Custom KB Entries</h2>
            <div className="kb-list">
              {kbEntries.length === 0 && <div className="kb-item-body">No custom entries yet.</div>}
              {kbEntries.map((entry) => (
                <div key={entry.id} className="kb-item">
                  <div className="kb-item-title">{entry.kb_key} <span className="kb-pill">{entry.category}</span></div>
                  <div className="kb-item-body">{entry.title_en || entry.title_my || "Untitled"}</div>
                  <div className="kb-tags">{entry.content_en || entry.content_my || ""}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="admin-card">
            <h2>Events Calendar</h2>
            <form className="admin-form compact" onSubmit={submitEvent}>
              <select value={eventForm.sourceLang} onChange={(e) => setEventForm({ ...eventForm, sourceLang: e.target.value })}>
                <option value="en">Source: English</option>
                <option value="my">Source: Myanmar</option>
              </select>
              <input value={eventForm.titleEn} onChange={(e) => setEventForm({ ...eventForm, titleEn: e.target.value })} placeholder="Title (English)" />
              <input value={eventForm.titleMy} onChange={(e) => setEventForm({ ...eventForm, titleMy: e.target.value })} placeholder="Title (Myanmar)" />
              <input value={eventForm.descriptionEn} onChange={(e) => setEventForm({ ...eventForm, descriptionEn: e.target.value })} placeholder="Description (English)" />
              <input value={eventForm.descriptionMy} onChange={(e) => setEventForm({ ...eventForm, descriptionMy: e.target.value })} placeholder="Description (Myanmar)" />
              <select value={eventForm.venue} onChange={(e) => setEventForm({ ...eventForm, venue: e.target.value })} required>
                <option value="" disabled>Select event venue</option>
                {eventVenueOptions.map((venueName) => (
                  <option key={venueName} value={venueName}>{venueName}</option>
                ))}
              </select>
              <input type="date" value={eventForm.startDate} onChange={(e) => setEventForm({ ...eventForm, startDate: e.target.value })} required />
              <input type="date" value={eventForm.endDate} onChange={(e) => setEventForm({ ...eventForm, endDate: e.target.value })} required />
              <button type="submit">Save Event</button>
            </form>
            <div className="admin-list">
              {events.map((row) => (
                <div key={row.id} className="admin-item">
                  <div><strong>{row.title_en}</strong> | {row.start_date} to {row.end_date}{normalizeVenue(row.venue) ? ` | venue: ${normalizeVenue(row.venue)}` : ""}</div>
                  <div className="admin-item-sub">{row.title_my}</div>
                  <div className="admin-item-actions">
                    <button onClick={() => editEvent(row)}>Edit</button>
                    <button onClick={() => removeEvent(row.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="admin-card">
            <h2>Reservations</h2>
            <form className="admin-form compact" onSubmit={submitReservation}>
              <input value={reservationForm.guestName} onChange={(e) => setReservationForm({ ...reservationForm, guestName: e.target.value })} placeholder="Guest name" required />
              <input value={reservationForm.contact} onChange={(e) => setReservationForm({ ...reservationForm, contact: e.target.value })} placeholder="Contact" />
              <select value={reservationForm.roomType} onChange={(e) => setReservationForm({ ...reservationForm, roomType: e.target.value })} required>
                <option value="">Room type</option>
                {ROOM_TYPE_OPTIONS.map((roomType) => (
                  <option key={roomType} value={roomType}>{roomType}</option>
                ))}
              </select>
              <input type="date" value={reservationForm.checkInDate} onChange={(e) => setReservationForm({ ...reservationForm, checkInDate: e.target.value })} required />
              <input type="date" value={reservationForm.checkOutDate} onChange={(e) => setReservationForm({ ...reservationForm, checkOutDate: e.target.value })} required />
              <input type="number" value={reservationForm.roomCount} onChange={(e) => setReservationForm({ ...reservationForm, roomCount: e.target.value })} placeholder="Rooms" required />
              <select value={reservationForm.status} onChange={(e) => setReservationForm({ ...reservationForm, status: e.target.value })}>
                <option value="confirmed">confirmed</option>
                <option value="pending">pending</option>
                <option value="cancelled">cancelled</option>
                <option value="completed">completed</option>
              </select>
              <input value={reservationForm.notes} onChange={(e) => setReservationForm({ ...reservationForm, notes: e.target.value })} placeholder="Notes" />
              <button type="submit">Save Reservation</button>
            </form>
            <div className="admin-list">
              {reservations.map((row) => (
                <div key={row.id} className="admin-item">
                  <div><strong>{row.guest_name}</strong> | {row.room_type} | {row.status}</div>
                  <div>{row.check_in_date} to {row.check_out_date} | rooms: {row.room_count}</div>
                  <div className="admin-item-actions">
                    <button onClick={() => editReservation(row)}>Edit</button>
                    <button onClick={() => removeReservation(row.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="admin-card">
            <h2>KB Entries</h2>
            <form className="admin-form compact" onSubmit={submitKbEntry}>
              <input value={kbForm.kbKey} onChange={(e) => setKbForm({ ...kbForm, kbKey: e.target.value })} placeholder="Key (unique)" required />
              <input value={kbForm.category} onChange={(e) => setKbForm({ ...kbForm, category: e.target.value })} placeholder="Category" required />
              <select value={kbForm.sourceLang} onChange={(e) => setKbForm({ ...kbForm, sourceLang: e.target.value })}>
                <option value="en">Source: English</option>
                <option value="my">Source: Myanmar</option>
              </select>
              <input value={kbForm.titleEn} onChange={(e) => setKbForm({ ...kbForm, titleEn: e.target.value })} placeholder="Title (English)" />
              <input value={kbForm.titleMy} onChange={(e) => setKbForm({ ...kbForm, titleMy: e.target.value })} placeholder="Title (Myanmar)" />
              <textarea value={kbForm.contentEn} onChange={(e) => setKbForm({ ...kbForm, contentEn: e.target.value })} placeholder="Content (English)" rows={2} />
              <textarea value={kbForm.contentMy} onChange={(e) => setKbForm({ ...kbForm, contentMy: e.target.value })} placeholder="Content (Myanmar)" rows={2} />
              <input value={kbForm.tags} onChange={(e) => setKbForm({ ...kbForm, tags: e.target.value })} placeholder="Tags (comma-separated)" />
              <button type="submit">Save KB Entry</button>
            </form>
            <div className="admin-list">
              {kbEntries.map((row) => (
                <div key={row.id} className="admin-item">
                  <div><strong>{row.kb_key}</strong> | {row.category}</div>
                  <div className="admin-item-sub">{row.title_en}</div>
                  <div className="admin-item-sub">{row.title_my}</div>
                  <div className="admin-item-actions">
                    <button onClick={() => editKbEntry(row)}>Edit</button>
                    <button onClick={() => removeKbEntry(row.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function App() {
  const isKbPage = window.location.pathname === "/admin/kb";
  if (isKbPage) {
    return <KnowledgeBasePage />;
  }
  const isAdminPage = window.location.pathname === "/admin";
  if (isAdminPage) {
    return <AdminPage />;
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

        if (import.meta.env.VITE_DEBUG_CHAT === "1" && data?.debug) {
          console.group("chat debug");
          data.debug.forEach((entry) => {
          if (entry && typeof entry.value === "string") {
          console.log(`${entry.label}:`, entry.value);
          } else if (entry) {
          console.log(entry.label, entry.value);
        }
        });
        console.groupEnd();
        }
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

        if (import.meta.env.VITE_DEBUG_CHAT === "1" && data?.debug) {
          console.group("chat debug");
          data.debug.forEach((entry) => {
          if (entry && typeof entry.value === "string") {
          console.log(`${entry.label}:`, entry.value);
          } else if (entry) {
          console.log(entry.label, entry.value);
        }
        });
        console.groupEnd();
      }

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
