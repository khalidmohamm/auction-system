-- Auction System — PostgreSQL Schema
-- Run this ONCE in Supabase SQL Editor (Dashboard → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS owners (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zones (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  zone_color TEXT DEFAULT '#1a6a9a',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS key_closets (
  id SERIAL PRIMARY KEY,
  closet_no INTEGER NOT NULL,
  row_no INTEGER NOT NULL,
  slots_per_row INTEGER DEFAULT 200,
  owner_id INTEGER REFERENCES owners(id) ON DELETE SET NULL,
  zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(closet_no, row_no)
);

CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  sequence_no INTEGER,
  vin TEXT UNIQUE,
  plate_letters TEXT,
  plate_numbers TEXT,
  owner_id INTEGER REFERENCES owners(id),
  brand TEXT,
  model TEXT,
  color TEXT,
  year INTEGER,
  status TEXT DEFAULT 'يعمل' CHECK(status IN ('يعمل','لا يعمل','بدون مفاتيح','تالف','مباع')),
  has_keys INTEGER DEFAULT 1,
  zone_id INTEGER REFERENCES zones(id),
  zone_note TEXT,
  parking_row TEXT,
  parking_slot TEXT,
  key_closet TEXT,
  key_closet_id INTEGER REFERENCES key_closets(id),
  kc_slot_no INTEGER,
  in_auction INTEGER DEFAULT 1,
  entry_time TEXT,
  exit_time TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicle_images (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicle_log (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS key_checkouts (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  checkout_time TIMESTAMP DEFAULT NOW(),
  return_time TIMESTAMP,
  returned INTEGER DEFAULT 0,
  notes TEXT
);

-- Seed default drivers
INSERT INTO drivers (name) VALUES ('مصطفى'), ('مكرم'), ('عبدالرؤوف'), ('عبدالله')
ON CONFLICT DO NOTHING;
