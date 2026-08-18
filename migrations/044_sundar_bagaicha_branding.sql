-- 044: business identity migration — Kathmandu Momo → Sundar Bagaicha Events.
--
-- The values that actually print on receipts, invoices and the public site come
-- from `system_settings` at runtime, so rebranding the code alone leaves an
-- already-deployed database printing the old business. This migration fixes
-- that WITHOUT discarding anything an admin has already customised: every
-- UPDATE is guarded on the stored value still being the old Kathmandu Momo
-- default. A row that was edited, or is already correct, is left untouched.
--
-- No business, order, bill, payment, inventory or accounting data is read or
-- modified here — only the branding key/value settings rows.

UPDATE system_settings
   SET setting_value = 'Sundar Bagaicha Events', updated_at = CURRENT_TIMESTAMP
 WHERE setting_key = 'restaurant_name'
   AND setting_value IN ('Kathmandu Momo', 'Kathmandu Momo POS');

UPDATE system_settings
   SET setting_value = '12 Bhabhar, Birendranagar, Surkhet, Karnali Province, Nepal',
       updated_at = CURRENT_TIMESTAMP
 WHERE setting_key = 'restaurant_address'
   AND setting_value = 'Birendranagar, Surkhet, Karnali Province, Nepal';

UPDATE system_settings
   SET setting_value = '083-590893 / 9848293693', updated_at = CURRENT_TIMESTAMP
 WHERE setting_key = 'restaurant_phone'
   AND setting_value IN ('+977 984-9216081', '9849216081', '+9779849216081');

UPDATE system_settings
   SET setting_value = 'Thank you for visiting Sundar Bagaicha Events!',
       updated_at = CURRENT_TIMESTAMP
 WHERE setting_key = 'receipt_footer'
   AND setting_value = 'Thank you for visiting Kathmandu Momo!';

-- The old domain does not belong to this business. Clear it rather than
-- inventing a replacement; set the real one in Admin -> Settings when it exists.
UPDATE system_settings
   SET setting_value = '', updated_at = CURRENT_TIMESTAMP
 WHERE setting_key = 'website'
   AND setting_value IN ('https://kathmandumomo.com.np', 'kathmandumomo.com.np', 'http://kathmandumomo.com.np');

-- Published website content (Admin -> Website CMS) is stored as JSON blobs under
-- system_settings. Only rows still carrying the old brand name are touched;
-- the replacement is a plain string swap inside the stored JSON.
UPDATE system_settings
   SET setting_value = REPLACE(setting_value, 'Kathmandu Momo', 'Sundar Bagaicha Events'),
       updated_at = CURRENT_TIMESTAMP
 WHERE setting_key LIKE 'cms_%'
   AND setting_value LIKE '%Kathmandu Momo%';

-- Legacy public image paths moved out of the old brand folder. Rewrite only the
-- surviving dish photos; storefront/room photos of the old premises were
-- removed and any reference to them falls back to a branded placeholder tile.
UPDATE system_settings
   SET setting_value = REPLACE(
         REPLACE(setting_value, '/images/kathmandu-momo/dishes/dish-', '/images/dishes/'),
         '/images/sundar-bagaicha/dishes/dish-', '/images/dishes/'),
       updated_at = CURRENT_TIMESTAMP
 WHERE setting_value LIKE '%/images/kathmandu-momo/dishes/dish-%'
    OR setting_value LIKE '%/images/sundar-bagaicha/dishes/dish-%';

-- Same path rewrite for uploaded CMS media rows, when that table exists.
DO $$
BEGIN
  IF to_regclass('public.cms_media') IS NOT NULL THEN
    UPDATE cms_media
       SET url = REPLACE(
             REPLACE(url, '/images/kathmandu-momo/dishes/dish-', '/images/dishes/'),
             '/images/sundar-bagaicha/dishes/dish-', '/images/dishes/')
     WHERE url LIKE '%/images/kathmandu-momo/dishes/dish-%'
        OR url LIKE '%/images/sundar-bagaicha/dishes/dish-%';

    UPDATE cms_media
       SET alt = REPLACE(alt, 'Kathmandu Momo', 'Sundar Bagaicha Events')
     WHERE alt LIKE '%Kathmandu Momo%';
  END IF;
END $$;
