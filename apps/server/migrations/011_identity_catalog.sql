-- Existing identities and their ownership/history keep their stable IDs.
ALTER TABLE identities
 ADD COLUMN occupation_code text NOT NULL DEFAULT '',
 ADD COLUMN occupation text NOT NULL DEFAULT '',
 ADD COLUMN persona jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(persona)='object'),
 ADD COLUMN persona_version bigint NOT NULL DEFAULT 1 CHECK (persona_version>=1);
CREATE INDEX identities_catalog_order ON identities(occupation_code,age,id);
