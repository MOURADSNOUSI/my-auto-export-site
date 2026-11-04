-- Journal des contrôles SEO (worker/seo.js) : après chaque publication ou retrait, et chaque jour à 07:00 (Paris).
-- Les 90 derniers contrôles sont conservés.
CREATE TABLE seo_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  declencheur TEXT NOT NULL CHECK (declencheur IN ('publication', 'quotidien')),
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  resume TEXT NOT NULL
);
