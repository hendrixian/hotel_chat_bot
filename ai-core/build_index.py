import json
import os
from pathlib import Path

import faiss
import numpy as np
from dotenv import load_dotenv
from FlagEmbedding import BGEM3FlagModel

load_dotenv()

MODEL_NAME = os.getenv("MODEL_NAME", "BAAI/bge-m3")
KB_PATH = os.getenv("KB_PATH", "../backend/data/kb.json")
INDEX_PATH = os.getenv("INDEX_PATH", "./data/index.faiss")
META_PATH = os.getenv("META_PATH", "./data/meta.json")
EMBED_MAX_LENGTH = int(os.getenv("EMBED_MAX_LENGTH", "512"))
EMBED_FP16 = os.getenv("EMBED_FP16", "true").lower() == "true"


def format_list(items):
    if not items:
        return ""
    return ", ".join([str(item) for item in items])


def localize_value(value, lang):
    if isinstance(value, dict) and ("en" in value or "my" in value):
        if lang in value and value[lang]:
            return value[lang]
        if "en" in value and value["en"]:
            return value["en"]
        if "my" in value and value["my"]:
            return value["my"]
        return ""
    if isinstance(value, list):
        return [localize_value(item, lang) for item in value]
    if isinstance(value, dict):
        return {key: localize_value(val, lang) for key, val in value.items()}
    return value


def build_docs(kb, lang):
    docs = []

    identity = kb.get("hotel_identity")
    if identity:
        contact = identity.get("contact") or {}
        docs.append({
            "id": f"hotel-identity-{lang}",
            "text": (
                f"Hotel {identity.get('name')} ({identity.get('brand')}). "
                f"Address: {identity.get('address')}. "
                f"Description: {identity.get('description')}. "
                f"Rating: {identity.get('rating')} ({identity.get('stars')} stars). "
                f"Built {identity.get('year_built')}, renovated {identity.get('last_renovated')}. "
                f"Languages: {format_list(identity.get('languages_spoken'))}. "
                f"Nearby: {format_list(identity.get('nearby_landmarks'))}. "
                f"Contact: {contact.get('phone')}, {contact.get('email')}, {contact.get('website')}, {contact.get('whatsapp')}."
            ),
            "source": "hotel_identity",
            "language": lang
        })

    for room in kb.get("rooms", []):
        pricing = room.get("pricing") or {}
        docs.append({
            "id": f"room-{room.get('id')}-{lang}",
            "text": (
                f"{room.get('type')} with {room.get('bed')}. "
                f"Capacity {room.get('capacity')}. Size {room.get('size_sqm')} sqm. "
                f"View: {room.get('view')}. Floors: {format_list(room.get('floor_options'))}. "
                f"Smoking: {'yes' if room.get('smoking') else 'no'}. "
                f"Accessible: {'yes' if room.get('accessible') else 'no'}. "
                f"Available {room.get('available_rooms')}/{room.get('total_rooms')}. "
                f"Amenities: {format_list(room.get('amenities'))}. "
                f"Pricing: base ${pricing.get('base_price_usd')}, weekend ${pricing.get('weekend_price_usd')}, "
                f"high season ${pricing.get('high_season_price_usd')}, tax {pricing.get('tax_percent')}%, "
                f"service charge {pricing.get('service_charge_percent')}%."
            ),
            "source": "room",
            "language": lang
        })

    for facility in kb.get("facilities", []):
        docs.append({
            "id": f"facility-{facility.get('name', '').lower().replace(' ', '-')}-{lang}",
            "text": (
                f"Facility {facility.get('name')}. Hours: {facility.get('hours')}. "
                f"Location: {facility.get('location')}. Access: {facility.get('access')}."
            ),
            "source": "facility",
            "language": lang
        })

    for venue in kb.get("dining", []):
        docs.append({
            "id": f"dining-{venue.get('name', '').lower().replace(' ', '-')}-{lang}",
            "text": (
                f"Dining {venue.get('name')}: {venue.get('cuisine')}. "
                f"Hours: {venue.get('hours')}. Type: {venue.get('type')}. "
                f"Breakfast included: {'yes' if venue.get('breakfast_included') else 'no'}."
            ),
            "source": "dining",
            "language": lang
        })

    policies = kb.get("policies") or {}
    if policies:
        cancellation = policies.get("cancellation") or {}
        payment = policies.get("payment") or {}
        docs.append({
            "id": f"policies-{lang}",
            "text": (
                f"Policies: Check-in {policies.get('check_in')}, check-out {policies.get('check_out')}. "
                f"Early check-in: {policies.get('early_check_in')}. "
                f"Late check-out: {policies.get('late_check_out')}. "
                f"Cancellation: free until {cancellation.get('free_until_hours')} hours, "
                f"late fee {cancellation.get('late_cancellation_fee')}. "
                f"Payment methods: {format_list(payment.get('methods'))}. "
                f"Deposit required: {'yes' if payment.get('deposit_required') else 'no'}. "
                f"Children: {policies.get('children')}. Extra bed ${policies.get('extra_bed_usd')}. "
                f"Pets: {policies.get('pets')}. Smoking: {policies.get('smoking')}. "
                f"ID requirement: {policies.get('id_requirement')}."
            ),
            "source": "policy",
            "language": lang
        })

    for venue in kb.get("event_venues", []):
        pricing = venue.get("pricing") or {}
        docs.append({
            "id": f"event-{venue.get('name', '').lower().replace(' ', '-')}-{lang}",
            "text": (
                f"{venue.get('name')} venue for {venue.get('type')}, capacity {venue.get('capacity')}. "
                f"Layouts: {format_list(venue.get('layouts'))}. Equipment: {format_list(venue.get('equipment'))}. "
                f"Catering: {'available' if venue.get('catering_available') else 'not available'}. "
                f"Pricing: full day ${pricing.get('full_day_usd')}, half day ${pricing.get('half_day_usd')}, "
                f"hourly ${pricing.get('hourly_usd')}."
            ),
            "source": "event_venue",
            "language": lang
        })

    transportation = kb.get("transportation") or {}
    if transportation:
        airport = transportation.get("airport_shuttle") or {}
        parking = transportation.get("parking") or {}
        docs.append({
            "id": f"transportation-{lang}",
            "text": (
                f"Transportation: airport shuttle {'available' if airport.get('available') else 'not available'} "
                f"(${airport.get('price_usd')}, {airport.get('schedule')}). "
                f"Parking: {parking.get('type')} ({parking.get('price')}). "
                f"Car rental: {'yes' if transportation.get('car_rental') else 'no'}. "
                f"Nearby transport: {format_list(transportation.get('nearby_transport'))}."
            ),
            "source": "transportation",
            "language": lang
        })

    digital = kb.get("digital_services") or {}
    if digital:
        wifi = digital.get("wifi") or {}
        docs.append({
            "id": f"digital-services-{lang}",
            "text": (
                f"Digital services: WiFi {'available' if wifi.get('available') else 'not available'}, "
                f"{'free' if wifi.get('free') else 'paid'}, {wifi.get('speed')}. "
                f"Mobile check-in: {'yes' if digital.get('mobile_check_in') else 'no'}. "
                f"Contact channels: {format_list(digital.get('contact_channels'))}."
            ),
            "source": "digital_services",
            "language": lang
        })

    reviews = kb.get("reviews") or {}
    if reviews:
        categories = reviews.get("categories") or {}
        docs.append({
            "id": f"reviews-{lang}",
            "text": (
                f"Reviews: average rating {reviews.get('average_rating')} from {reviews.get('total_reviews')} reviews. "
                f"Cleanliness {categories.get('cleanliness')}, service {categories.get('service')}, "
                f"location {categories.get('location')}, value {categories.get('value')}. "
                f"Sample: {format_list(reviews.get('sample_reviews'))}."
            ),
            "source": "reviews",
            "language": lang
        })

    return docs


def load_docs():
    if not os.path.exists(KB_PATH):
        return []

    with open(KB_PATH, "r", encoding="utf-8") as f:
        kb = json.load(f)

    docs = []
    for lang in ("en", "my"):
        localized = localize_value(kb, lang)
        docs.extend(build_docs(localized, lang))

    return docs


def normalize_embeddings(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True) + 1e-12
    return vectors / norms


def main():
    docs = load_docs()
    if not docs:
        raise SystemExit("No documents found. Check KB_PATH or kb.json.")

    model = BGEM3FlagModel(MODEL_NAME, use_fp16=EMBED_FP16)
    texts = [doc["text"] for doc in docs]
    embeddings = model.encode(texts, max_length=EMBED_MAX_LENGTH)["dense_vecs"]
    embeddings = normalize_embeddings(np.asarray(embeddings, dtype=np.float32))

    dim = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)

    Path(os.path.dirname(INDEX_PATH) or ".").mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, INDEX_PATH)

    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=2)

    print(f"Saved index to {INDEX_PATH} and metadata to {META_PATH}")


if __name__ == "__main__":
    main()
