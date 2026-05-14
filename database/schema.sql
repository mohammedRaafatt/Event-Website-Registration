-- PostgreSQL Schema for Event Registration System

-- Drop tables if they exist
DROP TABLE IF EXISTS registrations CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Create function for updating timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(191) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'attendee',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_role ON users (role);

-- Events table
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(120) NOT NULL UNIQUE,
    title VARCHAR(200) NOT NULL,
    summary VARCHAR(400) DEFAULT NULL,
    description TEXT,
    location VARCHAR(220) NOT NULL DEFAULT '',
    starts_at TIMESTAMP NOT NULL,
    ends_at TIMESTAMP NULL,
    capacity INTEGER NOT NULL DEFAULT 100,
    price_cents INTEGER NOT NULL DEFAULT 0,
    published SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_events_starts ON events (starts_at);
CREATE INDEX idx_events_published ON events (published);

-- Trigger for events updated_at
CREATE TRIGGER update_events_updated_at
BEFORE UPDATE ON events
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Registrations table
CREATE TABLE registrations (
    id BIGSERIAL PRIMARY KEY,
    public_ref CHAR(10) NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    total_cents INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL DEFAULT 'confirmed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_reg_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_reg_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE RESTRICT
);

CREATE INDEX idx_reg_event ON registrations (event_id);
CREATE INDEX idx_reg_user ON registrations (user_id);
