-- Migration 001: initial schema
-- Blueprint §7: data model
-- Never modify this file — add a new migration instead.

CREATE TABLE IF NOT EXISTS account_groups (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accounts (
    id                  TEXT PRIMARY KEY NOT NULL,
    name                TEXT NOT NULL,
    category            TEXT NOT NULL DEFAULT 'personal',
    color               TEXT NOT NULL DEFAULT '#25D366',
    icon_text           TEXT NOT NULL DEFAULT '',
    avatar_path         TEXT,
    profile_name        TEXT NOT NULL DEFAULT '',
    group_id            TEXT REFERENCES account_groups(id) ON DELETE SET NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    muted               INTEGER NOT NULL DEFAULT 0,
    hibernate_minutes   INTEGER NOT NULL DEFAULT 0,
    zoom                REAL NOT NULL DEFAULT 1.0,
    mcp_draft           INTEGER NOT NULL DEFAULT 0,
    mcp_read            INTEGER NOT NULL DEFAULT 0,
    dnd_schedule        TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
    id              TEXT PRIMARY KEY NOT NULL,
    account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    phone_e164      TEXT NOT NULL,
    display_name    TEXT,
    stage           TEXT NOT NULL DEFAULT 'new',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (account_id, phone_e164)
);

CREATE TABLE IF NOT EXISTS tags (
    id      TEXT PRIMARY KEY NOT NULL,
    name    TEXT NOT NULL UNIQUE,
    color   TEXT NOT NULL DEFAULT '#888888'
);

CREATE TABLE IF NOT EXISTS contact_tags (
    contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, tag_id)
);

CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY NOT NULL,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id  TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    body        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id          TEXT PRIMARY KEY NOT NULL,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id  TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    title       TEXT NOT NULL DEFAULT '',
    snippet     TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS captures (
    id          TEXT PRIMARY KEY NOT NULL,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id  TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    title       TEXT NOT NULL DEFAULT '',
    file_path   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reminders (
    id              TEXT PRIMARY KEY NOT NULL,
    contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    due_at          TEXT,
    note            TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    snoozed_until   TEXT
);

CREATE TABLE IF NOT EXISTS templates (
    id          TEXT PRIMARY KEY NOT NULL,
    account_id  TEXT REFERENCES accounts(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    language    TEXT NOT NULL DEFAULT 'en',
    shortcut    TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY NOT NULL,
    value   TEXT NOT NULL DEFAULT 'null'
);

CREATE TABLE IF NOT EXISTS mcp_activity (
    id          TEXT PRIMARY KEY NOT NULL,
    at          TEXT NOT NULL DEFAULT (datetime('now')),
    client_name TEXT,
    tool        TEXT NOT NULL,
    account_id  TEXT,
    outcome     TEXT NOT NULL DEFAULT 'ok',
    detail      TEXT
);

-- Indices for common queries
CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
CREATE INDEX IF NOT EXISTS idx_notes_contact ON notes(contact_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_at, status);
CREATE INDEX IF NOT EXISTS idx_mcp_activity_at ON mcp_activity(at);
