-- A picture for each item: a link to an image the owner pastes in.
ALTER TABLE items ADD COLUMN image_url TEXT CHECK (image_url IS NULL OR (image_url LIKE 'https://%' AND length(image_url) <= 2000));

-- Covers for two of the imported books, from the Open Library Covers API
-- (looked up by ISBN). The Hobbit edition has no cover there yet.
UPDATE items SET image_url = 'https://covers.openlibrary.org/b/isbn/9780358653035-L.jpg'
 WHERE id = '5558c400-449a-442b-920f-9d53d0090105' AND image_url IS NULL;
UPDATE items SET image_url = 'https://covers.openlibrary.org/b/isbn/9780063280779-L.jpg'
 WHERE id = 'f1a93d54-20e5-4bd2-b056-616021fc4419' AND image_url IS NULL;
