-- Règles de plateforme configurables ; aucune règle nationale n'est déduite comme une loi.
CREATE TABLE seller_document_rules (
 country_code TEXT NOT NULL,
 seller_type TEXT NOT NULL CHECK(seller_type IN ('*','individual','professional')),
 kind TEXT NOT NULL CHECK(kind IN ('registration','ownership','diagnostic','roadworthiness','service_book','invoice','other')),
 required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1)),
 updated_by INTEGER NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL,
 PRIMARY KEY(country_code,seller_type,kind)
);
