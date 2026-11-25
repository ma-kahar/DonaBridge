-- Migration 002: account group colours
-- Groups are rendered as colour-coded rings around account avatars in the dock.

ALTER TABLE account_groups ADD COLUMN color TEXT NOT NULL DEFAULT '#25D366';
