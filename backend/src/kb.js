const fs = require("fs");
const path = require("path");
const { listRoomInventory, listEvents, listReservations, listKbEntries } = require("./db");
const { resolveRepoPath } = require("./env");

const KB_PATH = resolveRepoPath(process.env.KB_PATH, ["backend", "data", "kb.json"]);

let cachedKb = null;
let cachedMtime = 0;

function loadKb() {
  try {
    const stat = fs.statSync(KB_PATH);
    if (!cachedKb || stat.mtimeMs !== cachedMtime) {
      const raw = fs.readFileSync(KB_PATH, "utf-8");
      cachedKb = JSON.parse(raw);
      cachedMtime = stat.mtimeMs;
    }
    return cachedKb;
  } catch (err) {
    return null;
  }
}

function isLocalizedObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.prototype.hasOwnProperty.call(value, "en") || Object.prototype.hasOwnProperty.call(value, "my");
}

function localizeValue(value, lang) {
  if (isLocalizedObject(value)) {
    if (value[lang]) return value[lang];
    if (value.en) return value.en;
    if (value.my) return value.my;
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((item) => localizeValue(item, lang));
  }

  if (value && typeof value === "object") {
    const result = {};
    Object.entries(value).forEach(([key, val]) => {
      result[key] = localizeValue(val, lang);
    });
    return result;
  }

  return value;
}

function formatList(items) {
  if (!items) return "";
  if (Array.isArray(items)) return items.join(", ");
  return String(items);
}

function parseTags(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeDynamicData(baseKb) {
  const kb = baseKb && typeof baseKb === "object" ? { ...baseKb } : {};

  const inventory = listRoomInventory();
  const events = listEvents();
  const reservations = listReservations();
  const kbEntries = listKbEntries();

  if (inventory.length > 0) {
    kb.inventory_calendar = inventory.map((row) => ({
      id: row.id,
      room_type: row.room_type,
      date: row.date,
      total_rooms: row.total_rooms,
      available_rooms: row.available_rooms,
      price_usd: row.price_usd,
      notes: row.notes || ""
    }));
  }

  if (events.length > 0) {
    kb.events_calendar = events.map((row) => ({
      id: row.id,
      title: { en: row.title_en, my: row.title_my },
      description: { en: row.description_en || "", my: row.description_my || "" },
      venue: row.venue || "",
      start_date: row.start_date,
      end_date: row.end_date
    }));
  }

  if (kbEntries.length > 0) {
    kb.admin_kb_entries = kbEntries.map((row) => ({
      id: row.id,
      key: row.kb_key,
      category: row.category,
      title: { en: row.title_en, my: row.title_my },
      content: { en: row.content_en, my: row.content_my },
      tags: parseTags(row.tags),
      updated_at: row.updated_at
    }));
  }

  if (reservations.length > 0) {
    kb.reservations = reservations.map((row) => ({
      id: row.id,
      guest_name: row.guest_name,
      room_type: row.room_type,
      check_in_date: row.check_in_date,
      check_out_date: row.check_out_date,
      room_count: row.room_count,
      status: row.status,
      notes: row.notes || "",
      updated_at: row.updated_at
    }));
  }

  return kb;
}

function kbToDocs(kb) {
  if (!kb) return [];
  const docs = [];

  const identity = kb.hotel_identity;
  if (identity) {
    docs.push({
      text: `Hotel ${identity.name} (${identity.brand}). Address: ${identity.address}. Description: ${identity.description}. Rating: ${identity.rating} (${identity.stars} stars). Built ${identity.year_built}, renovated ${identity.last_renovated}. Languages: ${formatList(identity.languages_spoken)}. Nearby: ${formatList(identity.nearby_landmarks)}. Contact: ${identity.contact?.phone || ""}, ${identity.contact?.email || ""}, ${identity.contact?.website || ""}.`,
      source: "hotel_identity"
    });
  }

  if (Array.isArray(kb.rooms)) {
    kb.rooms.forEach((room) => {
      docs.push({
        text: `${room.type} with ${room.bed}. Capacity ${room.capacity}. Size ${room.size_sqm} sqm. View: ${room.view}. Floors: ${formatList(room.floor_options)}. Smoking: ${room.smoking ? "yes" : "no"}. Accessible: ${room.accessible ? "yes" : "no"}. Available ${room.available_rooms}/${room.total_rooms}. Amenities: ${formatList(room.amenities)}. Pricing: base $${room.pricing?.base_price_usd}, weekend $${room.pricing?.weekend_price_usd}, high season $${room.pricing?.high_season_price_usd}, tax ${room.pricing?.tax_percent}%, service charge ${room.pricing?.service_charge_percent}%.`,
        source: "room"
      });
    });
  }

  if (Array.isArray(kb.facilities)) {
    kb.facilities.forEach((facility) => {
      docs.push({
        text: `Facility ${facility.name}. Hours: ${facility.hours}. Location: ${facility.location}. Access: ${facility.access}.`,
        source: "facility"
      });
    });
  }

  if (Array.isArray(kb.dining)) {
    kb.dining.forEach((venue) => {
      docs.push({
        text: `Dining ${venue.name}: ${venue.cuisine}. Hours: ${venue.hours}. Type: ${venue.type}. Breakfast included: ${venue.breakfast_included ? "yes" : "no"}.`,
        source: "dining"
      });
    });
  }

  const policies = kb.policies;
  if (policies) {
    docs.push({
      text: `Policies: Check-in ${policies.check_in}, check-out ${policies.check_out}. Early check-in: ${policies.early_check_in}. Late check-out: ${policies.late_check_out}. Cancellation: free until ${policies.cancellation?.free_until_hours} hours, late fee ${policies.cancellation?.late_cancellation_fee}. Payment methods: ${formatList(policies.payment?.methods)}. Deposit required: ${policies.payment?.deposit_required ? "yes" : "no"}. Children: ${policies.children}. Extra bed $${policies.extra_bed_usd}. Pets: ${policies.pets}. Smoking: ${policies.smoking}. ID requirement: ${policies.id_requirement}.`,
      source: "policy"
    });
  }

  if (Array.isArray(kb.event_venues)) {
    kb.event_venues.forEach((venue) => {
      docs.push({
        text: `${venue.name} venue for ${venue.type}, capacity ${venue.capacity}. Layouts: ${formatList(venue.layouts)}. Equipment: ${formatList(venue.equipment)}. Catering: ${venue.catering_available ? "available" : "not available"}. Pricing: full day $${venue.pricing?.full_day_usd || ""}, half day $${venue.pricing?.half_day_usd || ""}, hourly $${venue.pricing?.hourly_usd || ""}.`,
        source: "event_venue"
      });
    });
  }

  const transportation = kb.transportation;
  if (transportation) {
    docs.push({
      text: `Transportation: airport shuttle ${transportation.airport_shuttle?.available ? "available" : "not available"} ($${transportation.airport_shuttle?.price_usd}, ${transportation.airport_shuttle?.schedule}). Parking: ${transportation.parking?.type} (${transportation.parking?.price}). Car rental: ${transportation.car_rental ? "yes" : "no"}. Nearby transport: ${formatList(transportation.nearby_transport)}.`,
      source: "transportation"
    });
  }

  const digital = kb.digital_services;
  if (digital) {
    docs.push({
      text: `Digital services: WiFi ${digital.wifi?.available ? "available" : "not available"}, ${digital.wifi?.free ? "free" : "paid"}, ${digital.wifi?.speed}. Mobile check-in: ${digital.mobile_check_in ? "yes" : "no"}. Contact channels: ${formatList(digital.contact_channels)}.`,
      source: "digital_services"
    });
  }

  const reviews = kb.reviews;
  if (reviews) {
    docs.push({
      text: `Reviews: average rating ${reviews.average_rating} from ${reviews.total_reviews} reviews. Cleanliness ${reviews.categories?.cleanliness}, service ${reviews.categories?.service}, location ${reviews.categories?.location}, value ${reviews.categories?.value}. Sample: ${formatList(reviews.sample_reviews)}.`,
      source: "reviews"
    });
  }

  if (Array.isArray(kb.inventory_calendar)) {
    kb.inventory_calendar.forEach((row) => {
      docs.push({
        text: `Inventory ${row.date}: ${row.room_type} has ${row.available_rooms}/${row.total_rooms} available rooms.${row.price_usd ? ` Price $${row.price_usd}.` : ""}${row.notes ? ` Notes: ${row.notes}.` : ""}`,
        source: "inventory"
      });
    });
  }

  if (Array.isArray(kb.events_calendar)) {
    kb.events_calendar.forEach((event) => {
      docs.push({
        text: `Event ${event.title}${event.venue ? ` at ${event.venue}` : ""} from ${event.start_date} to ${event.end_date}. ${event.description || ""}`.trim(),
        source: "event"
      });
    });
  }

  if (Array.isArray(kb.admin_kb_entries)) {
    kb.admin_kb_entries.forEach((entry) => {
      docs.push({
        text: `${entry.category}: ${entry.title}. ${entry.content}. Tags: ${formatList(entry.tags)}.`,
        source: "admin_kb"
      });
    });
  }

  if (Array.isArray(kb.reservations)) {
    kb.reservations.forEach((row) => {
      docs.push({
        text: `Reservation for ${row.room_type}: ${row.check_in_date} to ${row.check_out_date}, ${row.room_count} room(s), status ${row.status}.${row.notes ? ` Notes: ${row.notes}.` : ""}`,
        source: "reservation"
      });
    });
  }

  return docs;
}

function getKb() {
  const base = loadKb();
  return mergeDynamicData(base);
}

function getKbLocalized(lang) {
  const kb = getKb();
  if (!kb) return null;
  if (lang !== "en" && lang !== "my") return kb;
  return localizeValue(kb, lang);
}

function getKbDocs(language) {
  const kb = getKb();
  if (!kb) return [];
  const localized = language === "en" || language === "my" ? localizeValue(kb, language) : kb;
  return kbToDocs(localized);
}

module.exports = {
  getKb,
  getKbLocalized,
  getKbDocs
};
