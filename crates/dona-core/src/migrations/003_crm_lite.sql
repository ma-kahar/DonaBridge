-- Migration 003: LiteCRM
-- Pipelines, stages, deals, custom fields, unified tasks, activity timeline.
-- All data stays local. Nothing here can send messages.

CREATE TABLE IF NOT EXISTS pipelines (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
    id          TEXT PRIMARY KEY NOT NULL,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#3B82F6',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    wip_limit   INTEGER NOT NULL DEFAULT 0,
    is_won      INTEGER NOT NULL DEFAULT 0,
    is_lost     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deals (
    id             TEXT PRIMARY KEY NOT NULL,
    account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id     TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    pipeline_id    TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    stage_id       TEXT NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    value          REAL NOT NULL DEFAULT 0,
    currency       TEXT NOT NULL DEFAULT 'USD',
    probability    INTEGER NOT NULL DEFAULT 0,
    expected_close TEXT,
    owner          TEXT,
    status         TEXT NOT NULL DEFAULT 'open',
    lost_reason    TEXT,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_fields (
    id          TEXT PRIMARY KEY NOT NULL,
    account_id  TEXT REFERENCES accounts(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    field_type  TEXT NOT NULL DEFAULT 'text',
    options     TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contact_field_values (
    contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    field_id    TEXT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    value       TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (contact_id, field_id)
);

CREATE TABLE IF NOT EXISTS crm_tasks (
    id           TEXT PRIMARY KEY NOT NULL,
    account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id   TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    deal_id      TEXT REFERENCES deals(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    notes        TEXT,
    due_at       TEXT,
    priority     TEXT NOT NULL DEFAULT 'medium',
    status       TEXT NOT NULL DEFAULT 'open',
    notified     INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crm_activities (
    id          TEXT PRIMARY KEY NOT NULL,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id  TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    deal_id     TEXT REFERENCES deals(id) ON DELETE SET NULL,
    kind        TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deals_account ON deals(account_id);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals(pipeline_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON crm_tasks(account_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON crm_activities(contact_id, created_at);

-- Default sales pipeline. Fixed ids keep the UI and tests stable.
INSERT OR IGNORE INTO pipelines (id, name, is_default, sort_order)
VALUES ('pipe_sales', 'Sales', 1, 0);

INSERT OR IGNORE INTO pipeline_stages
    (id, pipeline_id, name, color, sort_order, wip_limit, is_won, is_lost)
VALUES
    ('stage_new',         'pipe_sales', 'New',         '#3B82F6', 0, 0, 0, 0),
    ('stage_qualified',   'pipe_sales', 'Qualified',   '#8B5CF6', 1, 0, 0, 0),
    ('stage_proposal',    'pipe_sales', 'Proposal',    '#F59E0B', 2, 0, 0, 0),
    ('stage_negotiation', 'pipe_sales', 'Negotiation', '#EC4899', 3, 0, 0, 0),
    ('stage_won',         'pipe_sales', 'Won',         '#10B981', 4, 0, 1, 0),
    ('stage_lost',        'pipe_sales', 'Lost',        '#EF4444', 5, 0, 0, 1);
