"""Seed a throwaway Dona Bridge database with fictional CRM data.

Usage:
    python scripts/seed-demo-data.py "C:\\Users\\Public\\Dona Bridge Demo\\dona.db"

The script refuses to touch a database whose path does not contain "demo", so
it can never wipe a real profile by accident. Create the database first by
starting the app once with DONA_DATA_DIR pointing at the demo folder.
"""

import sqlite3
import sys
from datetime import datetime, timedelta

db = sys.argv[1]
if "demo" not in db.lower():
    raise SystemExit("Refusing to seed: the database path must contain 'demo'.")
now = datetime.now()
iso = lambda d: d.strftime("%Y-%m-%d %H:%M:%S")

conn = sqlite3.connect(db)
conn.execute("PRAGMA foreign_keys = ON")

conn.executescript(
    """
    DELETE FROM crm_activities;
    DELETE FROM crm_tasks;
    DELETE FROM deals;
    DELETE FROM reminders;
    DELETE FROM notes;
    DELETE FROM bookmarks;
    DELETE FROM contact_tags;
    DELETE FROM tags;
    DELETE FROM contacts;
    DELETE FROM templates;
    DELETE FROM accounts;
    DELETE FROM account_groups;
    """
)

groups = [
    ("grp-sales", "Sales", 0, "#2F80ED"),
    ("grp-support", "Support", 1, "#25D366"),
]
conn.executemany("INSERT INTO account_groups (id,name,sort_order,color) VALUES (?,?,?,?)", groups)

accounts = [
    ("demo-nexora", "Nexora", "business", "#2F80ED", "N", "grp-sales", 0),
    ("demo-donatek", "Donatek", "business", "#25D366", "D", "grp-support", 1),
    ("demo-bluebird", "Bluebird", "personal", "#8B5CF6", "B", None, 2),
]
conn.executemany(
    """INSERT INTO accounts
       (id,name,category,color,icon_text,group_id,sort_order,profile_name,zoom)
       VALUES (?,?,?,?,?,?,?,?,1.0)""",
    [(*a, a[0]) for a in accounts],
)

contacts = [
    # id, account, phone, name, stage
    ("c-acme", "demo-nexora", "+15550100001", "Acme Support", "negotiating"),
    ("c-sara", "demo-nexora", "+15550100002", "Sara Demo", "follow_up"),
    ("c-northwind", "demo-nexora", "+15550100003", "Northwind Retail", "new"),
    ("c-blueharbor", "demo-nexora", "+15550100004", "Blue Harbor Ltd", "follow_up"),
    ("c-kite", "demo-nexora", "+15550100005", "Kite & Co.", "won"),
    ("c-orbit", "demo-nexora", "+15550100006", "Orbit Labs", "new"),
    ("c-greenline", "demo-nexora", "+15550100007", "Greenline", "negotiating"),
    ("c-lumen", "demo-nexora", "+15550100008", "Lumen Studio", "do_not_contact"),
    ("c-highland", "demo-donatek", "+15550100011", "Highland Traders", "follow_up"),
    ("c-metro", "demo-donatek", "+15550100012", "Metro Supply", "negotiating"),
    ("c-alba", "demo-donatek", "+15550100013", "Alba Design", "new"),
    ("c-nova", "demo-donatek", "+15550100014", "Nova Foods", "follow_up"),
    ("c-vertex", "demo-donatek", "+15550100015", "Vertex Group", "won"),
    ("c-blerina", "demo-bluebird", "+15550100021", "Blerina", "follow_up"),
    ("c-arben", "demo-bluebird", "+15550100022", "Arben", "new"),
    ("c-elira", "demo-bluebird", "+15550100023", "Elira", "won"),
]
conn.executemany(
    """INSERT INTO contacts (id,account_id,phone_e164,display_name,stage,created_at,updated_at)
       VALUES (?,?,?,?,?,datetime('now','-21 days'),datetime('now','-1 hours'))""",
    contacts,
)

tags = [
    ("t-vip", "VIP", "#F59E0B"),
    ("t-wholesale", "Wholesale", "#3B82F6"),
    ("t-followup", "Follow-up", "#8B5CF6"),
    ("t-new", "New lead", "#10B981"),
]
conn.executemany("INSERT INTO tags (id,name,color) VALUES (?,?,?)", tags)
conn.executemany(
    "INSERT INTO contact_tags (contact_id,tag_id) VALUES (?,?)",
    [
        ("c-acme", "t-vip"),
        ("c-acme", "t-wholesale"),
        ("c-northwind", "t-new"),
        ("c-sara", "t-followup"),
        ("c-greenline", "t-wholesale"),
        ("c-metro", "t-wholesale"),
        ("c-metro", "t-vip"),
        ("c-highland", "t-followup"),
    ],
)

deals = [
    ("d-acme", "demo-nexora", "c-acme", "stage_negotiation", "Acme - 12 units", 4800, 70, 4),
    ("d-northwind", "demo-nexora", "c-northwind", "stage_proposal", "Northwind annual retainer", 12000, 45, 12),
    ("d-blueharbor", "demo-nexora", "c-blueharbor", "stage_qualified", "Blue Harbor pilot", 3200, 30, 18),
    ("d-kite", "demo-nexora", "c-kite", "stage_won", "Kite & Co. renewal", 7500, 100, -6),
    ("d-greenline", "demo-nexora", "c-greenline", "stage_new", "Greenline expansion", 5600, 15, 25),
    ("d-metro", "demo-donatek", "c-metro", "stage_negotiation", "Metro Supply Q4", 9400, 65, 9),
    ("d-highland", "demo-donatek", "c-highland", "stage_proposal", "Highland wholesale", 6100, 40, 16),
    ("d-nova", "demo-donatek", "c-nova", "stage_qualified", "Nova Foods trial", 2500, 25, 21),
]
conn.executemany(
    """INSERT INTO deals
       (id,account_id,contact_id,pipeline_id,stage_id,title,value,currency,probability,
        expected_close,owner,sort_order,created_at,updated_at)
       VALUES (?,?,?,'pipe_sales',?,?,?,'USD',?,?, 'Demo owner',?,datetime('now','-14 days'),datetime('now','-2 hours'))""",
    [(d[0], d[1], d[2], d[3], d[4], d[5], d[6], iso(now + timedelta(days=d[7])), d[7]) for d in deals],
)

tasks = [
    ("task-1", "demo-nexora", "c-acme", "d-acme", "Send updated invoice NX-2048", "Mention the unchanged invoice reference and the Friday dispatch.", iso(now.replace(hour=16, minute=0, second=0)), "high", "open"),
    ("task-2", "demo-nexora", "c-northwind", "d-northwind", "Call back Northwind about the retainer", None, iso(now + timedelta(days=1, hours=2)), "medium", "open"),
    ("task-3", "demo-nexora", "c-sara", None, "Follow up with Sara", "She asked for the latest price list.", iso(now - timedelta(days=1)), "high", "open"),
    ("task-4", "demo-nexora", "c-greenline", "d-greenline", "Prepare wholesale price list", None, iso(now + timedelta(days=3)), "low", "open"),
    ("task-5", "demo-nexora", "c-acme", "d-acme", "Confirm delivery date for Acme", None, iso(now - timedelta(days=2)), "medium", "done"),
    ("task-6", "demo-donatek", "c-metro", "d-metro", "Review Metro Supply contract", None, iso(now + timedelta(days=2)), "high", "open"),
    ("task-7", "demo-donatek", "c-highland", "d-highland", "Send wholesale catalogue", None, iso(now + timedelta(days=4)), "medium", "open"),
]
conn.executemany(
    """INSERT INTO crm_tasks
       (id,account_id,contact_id,deal_id,title,notes,due_at,priority,status,completed_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,CASE WHEN ?='done' THEN datetime('now','-1 days') ELSE NULL END,datetime('now','-5 days'))""",
    [(*t, t[8]) for t in tasks],
)

activities = [
    ("a-1", "demo-nexora", "c-acme", "d-acme", "message", "Sent the updated quote and confirmed the Friday dispatch.", iso(now - timedelta(hours=2))),
    ("a-2", "demo-nexora", "c-acme", "d-acme", "note", "Customer prefers a single invoice reference (NX-2048).", iso(now - timedelta(days=1))),
    ("a-3", "demo-nexora", "c-northwind", "d-northwind", "call", "Discovery call - 20 minutes. Retainer scope agreed.", iso(now - timedelta(days=1, hours=4))),
    ("a-4", "demo-nexora", "c-kite", "d-kite", "message", "Renewal signed for another year.", iso(now - timedelta(days=3))),
    ("a-5", "demo-nexora", "c-sara", None, "note", "Wants the price list before the weekend.", iso(now - timedelta(days=2))),
    ("a-6", "demo-donatek", "c-metro", "d-metro", "call", "Contract review booked for Thursday.", iso(now - timedelta(days=1))),
    ("a-7", "demo-donatek", "c-highland", "d-highland", "message", "Asked for the wholesale catalogue.", iso(now - timedelta(hours=6))),
]
conn.executemany(
    "INSERT INTO crm_activities (id,account_id,contact_id,deal_id,kind,body,created_at) VALUES (?,?,?,?,?,?,?)",
    activities,
)

notes = [
    ("n-1", "demo-nexora", "c-acme", "Delivery: Friday dispatch, Monday arrival. Invoice reference stays NX-2048.", iso(now - timedelta(days=1))),
    ("n-2", "demo-nexora", "c-northwind", "Retainer includes monthly reporting and priority support.", iso(now - timedelta(days=2))),
    ("n-3", "demo-donatek", "c-metro", "Q4 volumes are up 18% versus last year.", iso(now - timedelta(days=4))),
]
conn.executemany(
    "INSERT INTO notes (id,account_id,contact_id,body,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    [(*n, n[3]) for n in notes],
)

reminders = [
    ("r-1", "c-acme", iso(now.replace(hour=17, minute=30, second=0)), "Confirm the signed invoice before end of day.", "pending", None),
    ("r-2", "c-northwind", iso(now + timedelta(days=2)), "Retainer contract to be countersigned.", "pending", None),
]
conn.executemany(
    "INSERT INTO reminders (id,contact_id,due_at,note,status,snoozed_until) VALUES (?,?,?,?,?,?)",
    reminders,
)

bookmarks = [
    ("b-1", "demo-nexora", "c-acme", "Pricing 2026 - wholesale", "Tier 2 applies from 10 units."),
    ("b-2", "demo-nexora", "c-kite", "Renewal checklist", "Signed copy stored in the shared folder."),
]
conn.executemany(
    "INSERT INTO bookmarks (id,account_id,contact_id,title,snippet) VALUES (?,?,?,?,?)",
    bookmarks,
)

templates = [
    ("tpl-1", "demo-nexora", "Quote follow-up", "Hi {name}, just checking in on the quote I sent. Happy to adjust the quantities if that helps.", "en", "/quote"),
    ("tpl-2", "demo-nexora", "Delivery update", "Hi {name}, your order leaves the warehouse on Friday and should arrive on Monday.", "en", "/delivery"),
]
conn.executemany(
    "INSERT INTO templates (id,account_id,name,body,language,shortcut) VALUES (?,?,?,?,?,?)",
    templates,
)

conn.commit()

for table in ("accounts", "contacts", "deals", "crm_tasks", "crm_activities", "notes", "tags"):
    print(table, conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0])
conn.close()
