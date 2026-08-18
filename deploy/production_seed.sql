-- =====================================================================
-- Sundar Bagaicha Events — production seed (Postgres)
-- Run AFTER deploy/production_schema.sql on a fresh database.
--
-- Loads, idempotently (safe to re-run):
--   1. Chart of Accounts + default cash drawer / bank
--   2. Business settings (Sundar Bagaicha Events branding, VAT/service, receipt)
--   3. First admin — login PIN 984898 (change after first sign-in)
--   4. Table floors, table types (categories) and tables T-01..T-12
--   5. Unit conversions (kg/g, l/ml, dozen/pcs, packet/pcs)
--   6. Full real menu: 20 categories, 197 items (food + bar, from the venue's
--      own printed menus). No photos yet (image_url NULL — add via Admin -> Products).
--      "Option" items are seeded at their single listed base price; the
--      source list flags which items have options but never says what the
--      options actually are, so no variant rows were invented. Add real
--      variants later via Admin -> Products, or supply the option names/
--      price deltas and this can be generated.
--   7. Inventory categories + ingredient master (opening stock 0 — the
--      client fills real stock later)
--   8. An empty recipe shell for every menu item (no ingredient lines —
--      this menu's dish compositions weren't supplied, so none were
--      invented; fill recipes in later via Admin -> Recipes so stock
--      auto-deducts on sale)
--   9. schema_migrations markers 001..038 so `npm run db:migrate` is a
--      no-op afterwards (and only applies anything newer than this)
--
-- Markers used for idempotency:
--   recipes.prep_notes      = '__dsp_seed__'
--   inventory_items.notes   = 'DSP seed ingredient'
--   unit_conversions.note   = '__dsp_seed__'
-- =====================================================================

BEGIN;

-- pgcrypto is needed to hash the admin PIN below (bcrypt-compatible $2a$).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================ 1. ACCOUNTS
INSERT INTO accounts (code, name, type, subtype, is_system) VALUES
  ('1000','Assets','asset',NULL,1),
  ('1010','Cash on Hand','asset','cash',1),
  ('1020','Bank','asset','bank',1),
  ('1100','Card Clearing','asset','clearing',1),
  ('1110','eSewa Clearing','asset','clearing',1),
  ('1120','Khalti Clearing','asset','clearing',1),
  ('1130','QR / Fonepay Clearing','asset','clearing',1),
  ('1140','Online Clearing','asset','clearing',1),
  ('1200','Inventory','asset','inventory',1),
  ('1300','Accounts Receivable','asset','receivable',1),
  ('2000','Liabilities','liability',NULL,1),
  ('2010','Accounts Payable','liability','payable',1),
  ('2020','VAT / Tax Payable','liability','tax_payable',1),
  ('3000','Equity','equity',NULL,1),
  ('3010','Owner''s Equity','equity',NULL,1),
  ('3020','Opening Balance Equity','equity',NULL,1),
  ('4000','Income','income',NULL,1),
  ('4010','Sales Revenue','income','sales',1),
  ('4020','Other Income','income',NULL,1),
  ('5000','Expenses','expense',NULL,1),
  ('5010','Purchases / COGS','expense','cogs',1),
  ('5020','Operating Expenses','expense','operating',1),
  ('5030','Payroll','expense','payroll',1),
  ('5040','Wastage / Inventory Loss','expense','wastage',1),
  ('5050','Payment Processing Fees','expense','fees',1),
  ('5060','Cash Over / Short','expense','variance',1)
ON CONFLICT (code) DO NOTHING;

UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='1000') WHERE code IN ('1010','1020','1100','1110','1120','1130','1140','1200','1300') AND parent_id IS NULL;
UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='2000') WHERE code IN ('2010','2020') AND parent_id IS NULL;
UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='3000') WHERE code IN ('3010','3020') AND parent_id IS NULL;
UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='4000') WHERE code IN ('4010','4020') AND parent_id IS NULL;
UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='5000') WHERE code IN ('5010','5020','5030','5040','5050','5060') AND parent_id IS NULL;

INSERT INTO cash_drawers (name) SELECT 'Main Drawer' WHERE NOT EXISTS (SELECT 1 FROM cash_drawers);
INSERT INTO bank_accounts (name, account_id)
  SELECT 'Primary Bank', (SELECT id FROM accounts WHERE code='1020') WHERE NOT EXISTS (SELECT 1 FROM bank_accounts);

-- ============================================================ 2. SETTINGS
INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('restaurant_name','Sundar Bagaicha Events'),
  ('restaurant_address','12 Bhabhar, Birendranagar, Surkhet, Karnali Province, Nepal'),
  ('restaurant_phone','083-590893 / 9848293693'),
  ('restaurant_email',''),
  ('vat_number',''),
  ('pan_number',''),
  ('vat_percentage','0'),
  ('service_charge_percentage','0'),
  ('currency','NPR'),
  ('receipt_footer','Thank you for visiting Sundar Bagaicha Events!'),
  ('receipt_paper_size','80'),
  ('website',''),
  ('qr_ordering_enabled','true'),
  ('bank_qr_image',''),
  ('esewa_qr_image',''),
  ('reservation_hold_minutes','30'),
  ('reservation_grace_minutes','20'),
  ('reservation_dining_minutes','90'),
  ('reservation_cleaning_minutes','10'),
  ('reservation_auto_cancel_minutes','20'),
  ('reservation_min_lead_minutes','60')
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================== 3. ADMIN
-- Login is PIN-based. Seeded PIN = 984898. CHANGE after first sign-in
-- (must_change_password forces a reset on first login).
INSERT INTO users (username, password_hash, full_name, role, is_active, must_change_password)
VALUES ('admin', crypt('984898', gen_salt('bf', 12)), 'Restaurant Admin', 'admin', 1, 1)
ON CONFLICT (username) DO NOTHING;

-- ============================================================== 4. FLOORS
INSERT INTO table_floors (name, normalized_name, sort_order) VALUES
  ('Ground',  'ground',  1),
  ('First',   'first',   2),
  ('Rooftop', 'rooftop', 3),
  ('Outdoor', 'outdoor', 4)
ON CONFLICT (normalized_name) DO NOTHING;

-- ---- table types (a.k.a. table categories) ----
INSERT INTO table_types (name, normalized_name, color, default_capacity) VALUES
  ('Regular', 'regular', '#3b82f6', 4),
  ('VIP',     'vip',     '#a855f7', 6),
  ('Family',  'family',  '#22c55e', 6),
  ('Couple',  'couple',  '#ec4899', 2),
  ('Outdoor', 'outdoor', '#f59e0b', 4),
  ('Counter', 'counter', '#64748b', 2)
ON CONFLICT (normalized_name) DO NOTHING;

-- ---- tables T-01..T-12 ----
INSERT INTO tables (table_number, capacity, status, floor, section, table_type, is_active)
SELECT v.num, v.cap, 'available', v.floor, v.section, v.ttype, 1
FROM (VALUES
  ('T-01', 2, 'Ground',  'Main',    'couple'),
  ('T-02', 2, 'Ground',  'Main',    'couple'),
  ('T-03', 4, 'Ground',  'Main',    'regular'),
  ('T-04', 4, 'Ground',  'Main',    'regular'),
  ('T-05', 4, 'Ground',  'Main',    'regular'),
  ('T-06', 6, 'Ground',  'Main',    'family'),
  ('T-07', 4, 'First',   'Hall',    'regular'),
  ('T-08', 4, 'First',   'Hall',    'regular'),
  ('T-09', 6, 'First',   'Hall',    'family'),
  ('T-10', 6, 'First',   'VIP',     'vip'),
  ('T-11', 4, 'Rooftop', 'Terrace', 'outdoor'),
  ('T-12', 4, 'Rooftop', 'Terrace', 'outdoor')
) AS v(num, cap, floor, section, ttype)
WHERE NOT EXISTS (SELECT 1 FROM tables t WHERE t.table_number = v.num);

-- ==================================================== 5. UNIT CONVERSIONS
INSERT INTO unit_conversions (from_unit, to_unit, factor, note) VALUES
  ('kg',     'g',   1000,  '__dsp_seed__'),
  ('g',      'kg',  0.001, '__dsp_seed__'),
  ('l',      'ml',  1000,  '__dsp_seed__'),
  ('ml',     'l',   0.001, '__dsp_seed__'),
  ('dozen',  'pcs', 12,    '__dsp_seed__'),
  ('packet', 'pcs', 1,     '__dsp_seed__')
ON CONFLICT (from_unit, to_unit) DO NOTHING;

-- ================================================= 6. MENU CATEGORIES (20)
-- Sundar Bagaicha Events food + bar menu. Transcribed verbatim from the
-- venue's own printed cards — see data/menu/sundar-bagaicha-menu.json for the
-- source photographs, transcription rules and the price conflicts below.
-- Regenerate with: node scripts/menu/build-menu-seed.mjs
--
-- Printed-card price conflicts the client should confirm in Admin -> Menu:
--   • Black Tea: The food card prints Black Tea twice on the same page: Rs 30 in the 'Desert' block and Rs 45 in the dedicated 'Tea/Coffee' block. Seeded at Rs 45 (dedicated block).
--   • Milk Tea: Food card prints Rs 40 ('Milk Tea / Lemon Tea', Desert block) and Rs 65 (Tea/Coffee block). Seeded at Rs 65.
--   • Hot Lemon with Honey: Food card Rs 120; bar card Rs 185.
--   • Mineral Water: Food card Rs 50; bar card Rs 35.
--   • Coke / Fanta / Sprite: Food card Rs 70; bar card Rs 85.
--   • Real Juice: Food card prints Rs 80 (Desert block, 'Guava, Mix Fruit, Mango') and Rs 150/400 (Soft Drinks block). Seeded as Glass Rs 150 / 1 Ltr Rs 400; the bar card's 'Juice (1 Ltr) Rs 425' is a third value.
--   • Red Bull: Food card Rs 350. The landing page listed Rs 200; the printed card is treated as current.
INSERT INTO menu_categories (name, display_order)
SELECT v.name, v.ord FROM (VALUES
  ('Snacks', 1),
  ('Breakfast & Light Bites', 2),
  ('Soups', 3),
  ('Momo', 4),
  ('Noodles & Thukpa', 5),
  ('Fried Rice', 6),
  ('Chicken Specialties', 7),
  ('Mutton Specialties', 8),
  ('Traditional Choila', 9),
  ('Royal Biryani', 10),
  ('Traditional Thali', 11),
  ('Curries', 12),
  ('Desserts', 13),
  ('Tea & Coffee', 14),
  ('Soft Drinks', 15),
  ('Beer', 16),
  ('Wine', 17),
  ('Domestic Spirits', 18),
  ('Imported Spirits', 19),
  ('Shots', 20)
) AS v(name, ord)
ON CONFLICT (name) DO NOTHING;

-- ================================================ 6a. MASTER FOOD GROUPS
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS food_group TEXT DEFAULT 'food';
UPDATE menu_categories SET food_group = 'beverage'
WHERE name IN ('Tea & Coffee', 'Soft Drinks', 'Beer', 'Wine', 'Domestic Spirits', 'Imported Spirits', 'Shots')
  AND COALESCE(food_group, 'food') <> 'beverage';
UPDATE menu_categories SET food_group = 'food'
WHERE name IN ('Snacks', 'Breakfast & Light Bites', 'Soups', 'Momo', 'Noodles & Thukpa', 'Fried Rice', 'Chicken Specialties', 'Mutton Specialties', 'Traditional Choila', 'Royal Biryani', 'Traditional Thali', 'Curries', 'Desserts')
  AND COALESCE(food_group, '') <> 'food';

-- ================================================= 6b. MENU ITEMS (197)
-- base_price is the smallest listed serving. Spirits sold by peg carry their
-- real per-size prices as menu_item_variants below, so the POS charges the
-- actual pour price instead of a multiple of the small measure.
INSERT INTO menu_items (name, category_id, base_price, is_available, display_order, image_url, description, tags)
SELECT v.name, c.id, v.price, 1, v.ord, NULL, v.descr, v.tags
FROM (VALUES
  -- Snacks
  ('Veg Boil','Snacks',300,1,NULL,NULL),
  ('Popcorn','Snacks',150,2,NULL,NULL),
  ('Aalo Jeera','Snacks',180,3,NULL,NULL),
  ('Aaloo Sadheko','Snacks',200,4,NULL,NULL),
  ('Bhatmas Sadheko','Snacks',190,5,NULL,NULL),
  ('Peanuts Sadheko','Snacks',220,6,NULL,NULL),
  ('Chips Chilly','Snacks',300,7,NULL,NULL),
  ('Mushroom Chilly','Snacks',350,8,NULL,NULL),
  ('Paneer Pakauda','Snacks',300,9,NULL,NULL),
  ('Veg Pakauda','Snacks',150,10,NULL,NULL),
  ('Lasun Poleko','Snacks',170,11,NULL,NULL),
  ('Kaju Fry','Snacks',490,12,NULL,NULL),
  ('Dry Papad','Snacks',120,13,NULL,NULL),
  ('Fry Papad','Snacks',180,14,NULL,NULL),
  ('Green Salad','Snacks',250,15,NULL,NULL),
  ('Fruits Salad','Snacks',380,16,NULL,NULL),
  ('Gundruk Sadheko','Snacks',150,17,NULL,NULL),
  ('Veg Khaja Set','Snacks',250,18,NULL,NULL),
  ('Chicken Khaja Set','Snacks',350,19,NULL,NULL),
  ('Spring Roll (Veg)','Snacks',160,20,NULL,NULL),
  ('Spring Roll (Chicken)','Snacks',220,21,NULL,NULL),
  ('Chauchau Sadheko','Snacks',150,22,NULL,NULL),
  ('Mustang Aalu','Snacks',280,23,NULL,NULL),
  ('French Fries','Snacks',200,24,NULL,NULL),
  ('Chatpate','Snacks',120,25,NULL,NULL),
  -- Breakfast & Light Bites
  ('Veg Sandwich','Breakfast & Light Bites',90,1,NULL,NULL),
  ('Chicken Sandwich','Breakfast & Light Bites',120,2,NULL,NULL),
  ('Veg Burger','Breakfast & Light Bites',150,3,NULL,NULL),
  ('Chicken Burger','Breakfast & Light Bites',180,4,NULL,NULL),
  ('Aalu Paratha','Breakfast & Light Bites',150,5,'Served with pickle & curd',NULL),
  ('Plain Paratha Set','Breakfast & Light Bites',130,6,'3pcs with Veg Aalu Matar',NULL),
  ('Grand Breakfast Combo','Breakfast & Light Bites',300,7,'Sausage, 2 boiled eggs, and choice of sandwich OR 2pcs Aalu Paratha',NULL),
  -- Soups
  ('Veg Manchow Soup','Soups',120,1,NULL,NULL),
  ('Mushroom Soup','Soups',150,2,NULL,NULL),
  ('Hot and Sour Soup','Soups',160,3,NULL,NULL),
  ('Tomato Cream Soup','Soups',160,4,NULL,NULL),
  ('Chicken Manchow Soup','Soups',160,5,NULL,NULL),
  ('Local Chicken Soup','Soups',220,6,NULL,NULL),
  ('Mutton Soup','Soups',200,7,NULL,NULL),
  -- Momo
  ('Veg Steam Momo','Momo',140,1,NULL,NULL),
  ('Veg Fry Momo','Momo',150,2,NULL,NULL),
  ('Veg Chilly / C-Momo','Momo',180,3,NULL,NULL),
  ('Chicken Steam Momo','Momo',160,4,NULL,NULL),
  ('Chicken Fry Momo','Momo',180,5,NULL,NULL),
  ('Chicken Chilly / C-Momo','Momo',200,6,NULL,NULL),
  -- Noodles & Thukpa
  ('Veg Chowmein','Noodles & Thukpa',130,1,NULL,NULL),
  ('Veg Thukpa','Noodles & Thukpa',130,2,NULL,NULL),
  ('Egg Chowmein','Noodles & Thukpa',140,3,NULL,NULL),
  ('Egg Thukpa','Noodles & Thukpa',150,4,NULL,NULL),
  ('Chicken Chowmein','Noodles & Thukpa',160,5,NULL,NULL),
  ('Chicken Thukpa','Noodles & Thukpa',180,6,NULL,NULL),
  ('Mutton Thukpa','Noodles & Thukpa',250,7,NULL,NULL),
  ('Kima Noodles','Noodles & Thukpa',300,8,NULL,NULL),
  ('Veg Chopsuey','Noodles & Thukpa',200,9,NULL,NULL),
  ('American Chopsuey','Noodles & Thukpa',300,10,NULL,NULL),
  -- Fried Rice
  ('Veg Fried Rice','Fried Rice',150,1,NULL,NULL),
  ('Egg Fried Rice','Fried Rice',180,2,NULL,NULL),
  ('Chicken Fried Rice','Fried Rice',200,3,NULL,NULL),
  ('Mixed Fried Rice','Fried Rice',220,4,NULL,NULL),
  -- Chicken Specialties
  ('Chicken Roast','Chicken Specialties',200,1,NULL,NULL),
  ('Chicken Boil','Chicken Specialties',230,2,NULL,NULL),
  ('Chicken Lollipop','Chicken Specialties',280,3,NULL,NULL),
  ('Chicken Chilly','Chicken Specialties',260,4,NULL,NULL),
  ('Chicken Fry Sadheko','Chicken Specialties',270,5,NULL,NULL),
  ('Chicken Wings','Chicken Specialties',380,6,NULL,NULL),
  ('Chicken Timur','Chicken Specialties',300,7,'Szechuan pepper',NULL),
  ('Chicken Sekuwa','Chicken Specialties',200,8,NULL,NULL),
  ('Chicken Sausage','Chicken Specialties',200,9,NULL,NULL),
  -- Mutton Specialties
  ('Mutton Bhutan','Mutton Specialties',250,1,'Fried organ meat',NULL),
  ('Kan Jibro','Mutton Specialties',350,2,'Head/tongue delicacy',NULL),
  ('Mutton Sekuwa','Mutton Specialties',480,3,NULL,NULL),
  ('Mutton Pakku','Mutton Specialties',450,4,NULL,NULL),
  ('Mutton Tas','Mutton Specialties',400,5,NULL,NULL),
  ('Mutton Polera','Mutton Specialties',420,6,'Char-grilled',NULL),
  ('Mutton Fry Sadheko','Mutton Specialties',380,7,NULL,NULL),
  -- Traditional Choila
  ('Local Chicken Choila','Traditional Choila',330,1,NULL,NULL),
  ('Local Chicken Choila Poleko','Traditional Choila',380,2,'Grilled',NULL),
  ('Duck (Has) Choila Fry','Traditional Choila',350,3,NULL,NULL),
  ('Duck (Has) Choila Poleko','Traditional Choila',400,4,NULL,NULL),
  ('Mutton Choila Fry','Traditional Choila',400,5,NULL,NULL),
  ('Mutton Choila Poleko','Traditional Choila',450,6,NULL,NULL),
  -- Royal Biryani
  ('Veg Biryani','Royal Biryani',180,1,NULL,NULL),
  ('Egg Biryani','Royal Biryani',200,2,NULL,NULL),
  ('Mushroom Biryani','Royal Biryani',280,3,NULL,NULL),
  ('Chicken Biryani','Royal Biryani',420,4,NULL,NULL),
  ('Paneer Biryani','Royal Biryani',400,5,NULL,NULL),
  ('Mutton Biryani','Royal Biryani',500,6,NULL,NULL),
  -- Traditional Thali
  ('Veg Khana Set','Traditional Thali',280,1,NULL,NULL),
  ('Chicken Khana Set','Traditional Thali',350,2,NULL,NULL),
  ('Mutton Khana Set','Traditional Thali',550,3,NULL,NULL),
  ('Roti Curry','Traditional Thali',250,4,NULL,NULL),
  -- Curries
  ('Chicken Gravy','Curries',220,1,NULL,NULL),
  ('Chicken Masala','Curries',200,2,NULL,NULL),
  ('Chicken Kadhai','Curries',260,3,NULL,NULL),
  ('Butter Chicken','Curries',360,4,NULL,NULL),
  ('Mutton Curry','Curries',330,5,NULL,NULL),
  ('Mutton Gravy','Curries',350,6,NULL,NULL),
  ('Mutton Rogan Josh','Curries',380,7,NULL,NULL),
  -- Desserts
  ('Ice Cream','Desserts',90,1,'Choice of flavour',NULL),
  -- Tea & Coffee
  ('Black Tea','Tea & Coffee',45,1,NULL,NULL),
  ('Milk Tea','Tea & Coffee',65,2,NULL,NULL),
  ('Black Coffee','Tea & Coffee',50,3,NULL,NULL),
  ('Milk Coffee','Tea & Coffee',100,4,NULL,NULL),
  ('Hot Lemon with Honey','Tea & Coffee',120,5,NULL,NULL),
  ('Americano','Tea & Coffee',115,6,NULL,NULL),
  ('Espresso','Tea & Coffee',115,7,NULL,NULL),
  ('Cappuccino','Tea & Coffee',265,8,NULL,NULL),
  ('Cafe Latte / Honey Latte','Tea & Coffee',285,9,NULL,NULL),
  ('Caffe Mocha','Tea & Coffee',285,10,NULL,NULL),
  ('Hot Chocolate','Tea & Coffee',285,11,NULL,NULL),
  ('Iced Americano','Tea & Coffee',255,12,NULL,NULL),
  ('Iced Mocha','Tea & Coffee',285,13,NULL,NULL),
  ('Ice Cappuccino','Tea & Coffee',285,14,NULL,NULL),
  ('Cold Coffee','Tea & Coffee',305,15,NULL,NULL),
  -- Soft Drinks
  ('Mineral Water','Soft Drinks',50,1,NULL,NULL),
  ('Coke / Fanta / Sprite','Soft Drinks',70,2,NULL,NULL),
  ('Red Bull','Soft Drinks',350,3,NULL,NULL),
  ('Fresh Lime Soda','Soft Drinks',100,4,NULL,NULL),
  ('Mint Mojito','Soft Drinks',220,5,NULL,NULL),
  ('Real Juice','Soft Drinks',150,6,NULL,NULL),
  ('Jumbo Coke','Soft Drinks',425,7,NULL,NULL),
  ('Somersby Cider','Soft Drinks',265,8,NULL,NULL),
  ('Fresh Fruit Juice','Soft Drinks',335,9,NULL,NULL),
  ('Strawberry / Banana / Mango Shake','Soft Drinks',385,10,NULL,NULL),
  ('Choco / Vanilla / Strawberry / Oreo Shake','Soft Drinks',355,11,NULL,NULL),
  -- Beer
  ('Carlsberg Beer','Beer',675,1,NULL,NULL),
  ('Gorkha Strong','Beer',545,2,NULL,NULL),
  ('Tuborg Beer','Beer',545,3,NULL,NULL),
  ('San Miguel','Beer',412,4,NULL,NULL),
  ('Tuborg Gold','Beer',625,5,NULL,NULL),
  ('Tuborg Strong','Beer',545,6,NULL,NULL),
  ('Barahsinghe','Beer',495,7,NULL,NULL),
  ('Tuborg Strong Small','Beer',225,8,NULL,NULL),
  -- Wine
  ('Big Master (Red / White)','Wine',980,1,NULL,NULL),
  ('Jacobs Chardonnay','Wine',2565,2,NULL,NULL),
  ('Jacobs Double Barrel Shiraz','Wine',4455,3,NULL,NULL),
  ('Jacobs Merlot','Wine',2565,4,NULL,NULL),
  ('Jacobs Moscato White','Wine',2565,5,NULL,NULL),
  ('JP Chenet (Red / White)','Wine',2685,6,NULL,NULL),
  ('Robertson Sweet (Red / White)','Wine',2015,7,NULL,NULL),
  ('Hinwa Wine (Red / White)','Wine',1035,8,NULL,NULL),
  ('Canvas (Red / White)','Wine',1145,9,NULL,NULL),
  -- Domestic Spirits
  ('8848 Vodka','Domestic Spirits',365,1,NULL,'vodka'),
  ('Nude Vodka','Domestic Spirits',365,2,NULL,'vodka'),
  ('Ruslan','Domestic Spirits',345,3,NULL,'vodka'),
  ('Seto Bagh','Domestic Spirits',345,4,NULL,'vodka'),
  ('Smirnoff Vodka Red','Domestic Spirits',365,5,NULL,'vodka'),
  ('Yeti Vodka','Domestic Spirits',365,6,NULL,'vodka'),
  ('Bandipur','Domestic Spirits',915,7,NULL,'whiskey'),
  ('Black Chimney','Domestic Spirits',600,8,NULL,'whiskey'),
  ('Golden Oak','Domestic Spirits',195,9,NULL,'whiskey'),
  ('Gurkhas & Guns','Domestic Spirits',495,10,NULL,'whiskey'),
  ('Himalayan Reserve','Domestic Spirits',545,11,NULL,'whiskey'),
  ('Kala Patthar','Domestic Spirits',450,12,NULL,'whiskey'),
  ('Nepse Bulls','Domestic Spirits',745,13,NULL,'whiskey'),
  ('Old Durbar','Domestic Spirits',465,14,NULL,'whiskey'),
  ('Signature Green','Domestic Spirits',405,15,NULL,'whiskey'),
  ('Signature Premium','Domestic Spirits',425,16,NULL,'whiskey'),
  ('Signature Red','Domestic Spirits',365,17,NULL,'whiskey'),
  ('The Governor','Domestic Spirits',425,18,NULL,'whiskey'),
  ('Yarchagumba','Domestic Spirits',2750,19,NULL,'whiskey'),
  ('Honey Hunter Rum','Domestic Spirits',360,20,NULL,'rum'),
  ('Khukuri Rum','Domestic Spirits',355,21,NULL,'rum'),
  ('Khukuri Spice Rum','Domestic Spirits',375,22,NULL,'rum'),
  ('Old Monk Rum','Domestic Spirits',320,23,NULL,'rum'),
  ('Royal Stag','Domestic Spirits',485,24,NULL,'rum'),
  ('Grand Master Rum','Domestic Spirits',450,25,NULL,'rum'),
  ('Black Oak','Domestic Spirits',195,26,NULL,'rum'),
  -- Imported Spirits
  ('Absolut','Imported Spirits',690,1,NULL,'vodka'),
  ('Belvedere Vodka','Imported Spirits',1275,2,NULL,'vodka'),
  ('Grey Goose','Imported Spirits',1405,3,NULL,'vodka'),
  ('Beefeater','Imported Spirits',710,4,NULL,'gin'),
  ('Malfy Gin','Imported Spirits',765,5,NULL,'gin'),
  ('Bombay Sapphire','Imported Spirits',2635,6,NULL,'gin'),
  ('Blue Riband','Imported Spirits',445,7,NULL,'gin'),
  ('Ballantines Finest','Imported Spirits',720,8,NULL,'scotch'),
  ('Black Label','Imported Spirits',930,9,NULL,'scotch'),
  ('Chivas Regal 12 Yrs','Imported Spirits',930,10,NULL,'scotch'),
  ('Chivas Regal 18 Yrs','Imported Spirits',2365,11,NULL,'scotch'),
  ('Double Black','Imported Spirits',1100,12,NULL,'scotch'),
  ('Famous Grouse','Imported Spirits',695,13,NULL,'scotch'),
  ('Founders Reserve','Imported Spirits',1160,14,NULL,'scotch'),
  ('Red Label','Imported Spirits',705,15,NULL,'scotch'),
  ('Vat 69','Imported Spirits',655,16,NULL,'scotch'),
  ('Glenfiddich 12 Yrs','Imported Spirits',1575,17,NULL,'single malt'),
  ('Glenfiddich 15 Yrs','Imported Spirits',2470,18,NULL,'single malt'),
  ('Glenfiddich 18 Yrs','Imported Spirits',2695,19,NULL,'single malt'),
  ('Glenlivet 12 Yrs','Imported Spirits',1370,20,NULL,'single malt'),
  ('Glenlivet 18 Yrs','Imported Spirits',3425,21,NULL,'single malt'),
  ('Glenmorangie 10 Yrs','Imported Spirits',970,22,NULL,'single malt'),
  ('Macallan 12 Yrs','Imported Spirits',1275,23,NULL,'single malt'),
  ('Jack Daniels','Imported Spirits',845,24,NULL,'bourbon'),
  ('Jameson','Imported Spirits',795,25,NULL,'bourbon'),
  ('Jameson Black','Imported Spirits',785,26,NULL,'bourbon'),
  ('Jim Beam','Imported Spirits',835,27,NULL,'bourbon'),
  -- Shots
  ('Jagermeister','Shots',405,1,'30ml','shot'),
  ('Tequila (Gold / Silver)','Shots',345,2,'30ml','shot')
) AS v(name, cat, price, ord, descr, tags)
JOIN menu_categories c ON c.name = v.cat
WHERE NOT EXISTS (
  SELECT 1 FROM menu_items m WHERE m.name = v.name AND m.category_id = c.id
);

-- =============================================== 6c. SERVING SIZES (170 rows)
-- Absolute per-size prices (not modifiers) — lib/db/repositories/orders.js
-- re-resolves the price from this table server-side on every order line.
ALTER TABLE menu_item_variants ADD COLUMN IF NOT EXISTS price DOUBLE PRECISION;
INSERT INTO menu_item_variants (menu_item_id, variant_name, price, price_modifier, is_default)
SELECT m.id, v.variant_name, v.price, 0, v.is_default
FROM (VALUES
  ('Ice Cream','Desserts','Vanilla',90,1),
  ('Ice Cream','Desserts','Chocolate',90,0),
  ('Ice Cream','Desserts','Strawberry',90,0),
  ('Ice Cream','Desserts','Pineapple',90,0),
  ('Ice Cream','Desserts','Butterscotch',90,0),
  ('Americano','Tea & Coffee','Single',115,1),
  ('Americano','Tea & Coffee','Double',225,0),
  ('Espresso','Tea & Coffee','Single',115,1),
  ('Espresso','Tea & Coffee','Double',225,0),
  ('Real Juice','Soft Drinks','Glass',150,1),
  ('Real Juice','Soft Drinks','1 Ltr',400,0),
  ('8848 Vodka','Domestic Spirits','60ml',365,1),
  ('8848 Vodka','Domestic Spirits','180ml',675,0),
  ('8848 Vodka','Domestic Spirits','750ml',2685,0),
  ('Nude Vodka','Domestic Spirits','60ml',365,1),
  ('Nude Vodka','Domestic Spirits','180ml',720,0),
  ('Nude Vodka','Domestic Spirits','750ml',2685,0),
  ('Ruslan','Domestic Spirits','60ml',345,1),
  ('Ruslan','Domestic Spirits','180ml',690,0),
  ('Ruslan','Domestic Spirits','750ml',2690,0),
  ('Seto Bagh','Domestic Spirits','60ml',345,1),
  ('Seto Bagh','Domestic Spirits','180ml',690,0),
  ('Seto Bagh','Domestic Spirits','750ml',2760,0),
  ('Smirnoff Vodka Red','Domestic Spirits','60ml',365,1),
  ('Smirnoff Vodka Red','Domestic Spirits','180ml',720,0),
  ('Smirnoff Vodka Red','Domestic Spirits','750ml',2875,0),
  ('Yeti Vodka','Domestic Spirits','60ml',365,1),
  ('Yeti Vodka','Domestic Spirits','180ml',720,0),
  ('Yeti Vodka','Domestic Spirits','750ml',2875,0),
  ('Bandipur','Domestic Spirits','60ml',915,1),
  ('Bandipur','Domestic Spirits','180ml',1815,0),
  ('Bandipur','Domestic Spirits','750ml',7255,0),
  ('Black Chimney','Domestic Spirits','60ml',600,1),
  ('Black Chimney','Domestic Spirits','180ml',1205,0),
  ('Black Chimney','Domestic Spirits','750ml',4805,0),
  ('Golden Oak','Domestic Spirits','60ml',195,1),
  ('Golden Oak','Domestic Spirits','180ml',395,0),
  ('Golden Oak','Domestic Spirits','750ml',1550,0),
  ('Gurkhas & Guns','Domestic Spirits','60ml',495,1),
  ('Gurkhas & Guns','Domestic Spirits','180ml',980,0),
  ('Gurkhas & Guns','Domestic Spirits','750ml',3915,0),
  ('Himalayan Reserve','Domestic Spirits','60ml',545,1),
  ('Himalayan Reserve','Domestic Spirits','180ml',1095,0),
  ('Himalayan Reserve','Domestic Spirits','750ml',4355,0),
  ('Kala Patthar','Domestic Spirits','60ml',450,1),
  ('Kala Patthar','Domestic Spirits','180ml',895,0),
  ('Kala Patthar','Domestic Spirits','750ml',3580,0),
  ('Nepse Bulls','Domestic Spirits','60ml',745,1),
  ('Nepse Bulls','Domestic Spirits','180ml',1485,0),
  ('Nepse Bulls','Domestic Spirits','750ml',5930,0),
  ('Old Durbar','Domestic Spirits','60ml',465,1),
  ('Old Durbar','Domestic Spirits','180ml',925,0),
  ('Old Durbar','Domestic Spirits','750ml',3450,0),
  ('Signature Green','Domestic Spirits','60ml',405,1),
  ('Signature Green','Domestic Spirits','180ml',810,0),
  ('Signature Green','Domestic Spirits','750ml',3230,0),
  ('Signature Premium','Domestic Spirits','60ml',425,1),
  ('Signature Premium','Domestic Spirits','180ml',855,0),
  ('Signature Premium','Domestic Spirits','750ml',3165,0),
  ('Signature Red','Domestic Spirits','60ml',365,1),
  ('Signature Red','Domestic Spirits','180ml',725,0),
  ('Signature Red','Domestic Spirits','750ml',2940,0),
  ('The Governor','Domestic Spirits','60ml',425,1),
  ('The Governor','Domestic Spirits','180ml',850,0),
  ('The Governor','Domestic Spirits','750ml',3380,0),
  ('Yarchagumba','Domestic Spirits','60ml',2750,1),
  ('Yarchagumba','Domestic Spirits','180ml',5495,0),
  ('Yarchagumba','Domestic Spirits','750ml',14050,0),
  ('Honey Hunter Rum','Domestic Spirits','60ml',360,1),
  ('Honey Hunter Rum','Domestic Spirits','180ml',710,0),
  ('Honey Hunter Rum','Domestic Spirits','750ml',2840,0),
  ('Khukuri Rum','Domestic Spirits','60ml',355,1),
  ('Khukuri Rum','Domestic Spirits','180ml',600,0),
  ('Khukuri Rum','Domestic Spirits','750ml',2785,0),
  ('Khukuri Spice Rum','Domestic Spirits','60ml',375,1),
  ('Khukuri Spice Rum','Domestic Spirits','180ml',745,0),
  ('Khukuri Spice Rum','Domestic Spirits','750ml',2965,0),
  ('Old Monk Rum','Domestic Spirits','60ml',320,1),
  ('Old Monk Rum','Domestic Spirits','180ml',635,0),
  ('Old Monk Rum','Domestic Spirits','750ml',2540,0),
  ('Royal Stag','Domestic Spirits','60ml',485,1),
  ('Royal Stag','Domestic Spirits','180ml',975,0),
  ('Royal Stag','Domestic Spirits','750ml',2495,0),
  ('Grand Master Rum','Domestic Spirits','60ml',450,1),
  ('Grand Master Rum','Domestic Spirits','180ml',895,0),
  ('Grand Master Rum','Domestic Spirits','750ml',2555,0),
  ('Black Oak','Domestic Spirits','60ml',195,1),
  ('Black Oak','Domestic Spirits','180ml',425,0),
  ('Black Oak','Domestic Spirits','750ml',1690,0),
  ('Absolut','Imported Spirits','60ml',690,1),
  ('Absolut','Imported Spirits','200ml',2070,0),
  ('Absolut','Imported Spirits','1000ml',8285,0),
  ('Belvedere Vodka','Imported Spirits','60ml',1275,1),
  ('Belvedere Vodka','Imported Spirits','200ml',3815,0),
  ('Belvedere Vodka','Imported Spirits','1000ml',15255,0),
  ('Grey Goose','Imported Spirits','60ml',1405,1),
  ('Grey Goose','Imported Spirits','200ml',4200,0),
  ('Grey Goose','Imported Spirits','1000ml',16785,0),
  ('Beefeater','Imported Spirits','60ml',710,1),
  ('Beefeater','Imported Spirits','200ml',2120,0),
  ('Beefeater','Imported Spirits','1000ml',8485,0),
  ('Malfy Gin','Imported Spirits','60ml',765,1),
  ('Malfy Gin','Imported Spirits','200ml',2290,0),
  ('Malfy Gin','Imported Spirits','1000ml',9155,0),
  ('Bombay Sapphire','Imported Spirits','60ml',2635,1),
  ('Bombay Sapphire','Imported Spirits','200ml',5265,0),
  ('Bombay Sapphire','Imported Spirits','1000ml',13475,0),
  ('Blue Riband','Imported Spirits','60ml',445,1),
  ('Blue Riband','Imported Spirits','200ml',885,0),
  ('Blue Riband','Imported Spirits','1000ml',2250,0),
  ('Ballantines Finest','Imported Spirits','60ml',720,1),
  ('Ballantines Finest','Imported Spirits','200ml',2155,0),
  ('Ballantines Finest','Imported Spirits','1000ml',8605,0),
  ('Black Label','Imported Spirits','60ml',930,1),
  ('Black Label','Imported Spirits','200ml',2775,0),
  ('Black Label','Imported Spirits','1000ml',11110,0),
  ('Chivas Regal 12 Yrs','Imported Spirits','60ml',930,1),
  ('Chivas Regal 12 Yrs','Imported Spirits','200ml',2775,0),
  ('Chivas Regal 12 Yrs','Imported Spirits','1000ml',11110,0),
  ('Chivas Regal 18 Yrs','Imported Spirits','60ml',2365,1),
  ('Chivas Regal 18 Yrs','Imported Spirits','200ml',7080,0),
  ('Chivas Regal 18 Yrs','Imported Spirits','1000ml',28315,0),
  ('Double Black','Imported Spirits','60ml',1100,1),
  ('Double Black','Imported Spirits','200ml',3295,0),
  ('Double Black','Imported Spirits','1000ml',13185,0),
  ('Famous Grouse','Imported Spirits','60ml',695,1),
  ('Famous Grouse','Imported Spirits','200ml',2095,0),
  ('Famous Grouse','Imported Spirits','1000ml',8295,0),
  ('Founders Reserve','Imported Spirits','60ml',1160,1),
  ('Founders Reserve','Imported Spirits','200ml',3485,0),
  ('Founders Reserve','Imported Spirits','1000ml',13915,0),
  ('Red Label','Imported Spirits','60ml',705,1),
  ('Red Label','Imported Spirits','200ml',2110,0),
  ('Red Label','Imported Spirits','1000ml',8420,0),
  ('Vat 69','Imported Spirits','60ml',655,1),
  ('Vat 69','Imported Spirits','200ml',1955,0),
  ('Vat 69','Imported Spirits','1000ml',7810,0),
  ('Glenfiddich 12 Yrs','Imported Spirits','60ml',1575,1),
  ('Glenfiddich 12 Yrs','Imported Spirits','200ml',4720,0),
  ('Glenfiddich 12 Yrs','Imported Spirits','1000ml',18865,0),
  ('Glenfiddich 15 Yrs','Imported Spirits','60ml',2470,1),
  ('Glenfiddich 15 Yrs','Imported Spirits','200ml',7405,0),
  ('Glenfiddich 15 Yrs','Imported Spirits','1000ml',29605,0),
  ('Glenfiddich 18 Yrs','Imported Spirits','60ml',2695,1),
  ('Glenfiddich 18 Yrs','Imported Spirits','200ml',8095,0),
  ('Glenfiddich 18 Yrs','Imported Spirits','1000ml',32360,0),
  ('Glenlivet 12 Yrs','Imported Spirits','60ml',1370,1),
  ('Glenlivet 12 Yrs','Imported Spirits','200ml',4105,0),
  ('Glenlivet 12 Yrs','Imported Spirits','1000ml',16415,0),
  ('Glenlivet 18 Yrs','Imported Spirits','60ml',3425,1),
  ('Glenlivet 18 Yrs','Imported Spirits','200ml',10270,0),
  ('Glenlivet 18 Yrs','Imported Spirits','1000ml',41055,0),
  ('Glenmorangie 10 Yrs','Imported Spirits','60ml',970,1),
  ('Glenmorangie 10 Yrs','Imported Spirits','200ml',2900,0),
  ('Glenmorangie 10 Yrs','Imported Spirits','1000ml',11595,0),
  ('Macallan 12 Yrs','Imported Spirits','60ml',1275,1),
  ('Macallan 12 Yrs','Imported Spirits','200ml',3810,0),
  ('Macallan 12 Yrs','Imported Spirits','1000ml',15245,0),
  ('Jack Daniels','Imported Spirits','60ml',845,1),
  ('Jack Daniels','Imported Spirits','200ml',2535,0),
  ('Jack Daniels','Imported Spirits','1000ml',10135,0),
  ('Jameson','Imported Spirits','60ml',795,1),
  ('Jameson','Imported Spirits','200ml',2380,0),
  ('Jameson','Imported Spirits','1000ml',9525,0),
  ('Jameson Black','Imported Spirits','60ml',785,1),
  ('Jameson Black','Imported Spirits','200ml',2345,0),
  ('Jameson Black','Imported Spirits','1000ml',8790,0),
  ('Jim Beam','Imported Spirits','60ml',835,1),
  ('Jim Beam','Imported Spirits','200ml',2490,0),
  ('Jim Beam','Imported Spirits','1000ml',9945,0)
) AS v(item_name, cat, variant_name, price, is_default)
JOIN menu_categories c ON c.name = v.cat
JOIN menu_items m ON m.name = v.item_name AND m.category_id = c.id
WHERE NOT EXISTS (
  SELECT 1 FROM menu_item_variants x WHERE x.menu_item_id = m.id AND x.variant_name = v.variant_name
);

-- ================================================ 7. INVENTORY CATEGORIES
INSERT INTO inventory_categories (name, normalized_name)
SELECT v.name, lower(v.name) FROM (VALUES
  ('Grains & Flour'),
  ('Bakery'),
  ('Meat & Poultry'),
  ('Vegetables'),
  ('Fruits'),
  ('Dairy'),
  ('Oil & Fats'),
  ('Spices & Condiments'),
  ('Beverages')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM inventory_categories c WHERE lower(c.name) = lower(v.name));

-- ===================================== 7b. INGREDIENT MASTER (opening stock 0)
-- quantity = 0 on purpose: the client enters real stock later. cost/min are 0
-- too; only the recipe lines below carry per-dish amounts.
INSERT INTO inventory_items
  (item_name, name, quantity, unit, cost_per_unit, min_stock_level, min_stock, category, supplier, notes, created_at, updated_at)
SELECT v.item_name, v.item_name, 0, v.unit, 0, 0, 0, v.category,
       'To be set', 'DSP seed ingredient', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  -- Grains & Flour
  ('Rice','kg','Grains & Flour'),
  ('Basmati Rice','kg','Grains & Flour'),
  ('Maida (Flour)','kg','Grains & Flour'),
  ('Chowmein Noodles','kg','Grains & Flour'),
  ('Corn Kernels','kg','Grains & Flour'),
  -- Bakery
  ('Bread','pcs','Bakery'),
  ('Burger Bun','pcs','Bakery'),
  ('Pizza Base','pcs','Bakery'),
  ('Oreo Biscuit','pcs','Bakery'),
  -- Meat & Poultry
  ('Chicken','kg','Meat & Poultry'),
  ('Mutton','kg','Meat & Poultry'),
  ('Chicken Liver','kg','Meat & Poultry'),
  ('Chicken Sausage','pcs','Meat & Poultry'),
  ('Eggs','pcs','Meat & Poultry'),
  -- Vegetables
  ('Potato','kg','Vegetables'),
  ('Onion','kg','Vegetables'),
  ('Tomato','kg','Vegetables'),
  ('Mushroom','kg','Vegetables'),
  ('Mixed Vegetables','kg','Vegetables'),
  ('Peanuts','kg','Vegetables'),
  ('Cashew Nut','kg','Vegetables'),
  ('Mint Leaves','kg','Vegetables'),
  ('Lemon','pcs','Vegetables'),
  -- Fruits
  ('Watermelon','kg','Fruits'),
  ('Apple','kg','Fruits'),
  ('Orange','kg','Fruits'),
  ('Banana','pcs','Fruits'),
  ('Mixed Fruits','kg','Fruits'),
  -- Dairy
  ('Paneer','kg','Dairy'),
  ('Milk','l','Dairy'),
  ('Cheese','kg','Dairy'),
  ('Cream','l','Dairy'),
  ('Curd','kg','Dairy'),
  ('Ice Cream','l','Dairy'),
  -- Oil & Fats
  ('Cooking Oil','l','Oil & Fats'),
  ('Mustard Oil','l','Oil & Fats'),
  ('Ghee','kg','Oil & Fats'),
  -- Spices & Condiments
  ('Salt','kg','Spices & Condiments'),
  ('Sugar','kg','Spices & Condiments'),
  ('Mixed Spices (Masala)','kg','Spices & Condiments'),
  ('Biryani Masala','kg','Spices & Condiments'),
  ('Timur','kg','Spices & Condiments'),
  ('Black Pepper','kg','Spices & Condiments'),
  ('Soy Sauce','l','Spices & Condiments'),
  ('Chilli Sauce','l','Spices & Condiments'),
  ('Honey','kg','Spices & Condiments'),
  -- Beverages
  ('Coffee Powder','kg','Beverages'),
  ('Instant Coffee (Nescafe)','kg','Beverages'),
  ('Tea Leaves','kg','Beverages'),
  ('Green Tea Bag','pcs','Beverages'),
  ('Herbal Tea Bag','pcs','Beverages'),
  ('Cola Syrup','l','Beverages'),
  ('Chocolate Syrup','l','Beverages'),
  ('Real Juice Pack','pcs','Beverages'),
  ('Cold Drink Bottle','pcs','Beverages'),
  ('Red Bull Can','pcs','Beverages')
) AS v(item_name, unit, category)
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_items i WHERE i.item_name = v.item_name AND i.notes = 'DSP seed ingredient'
);

-- Backfill category_id from the category text.
UPDATE inventory_items i
SET category_id = c.id
FROM inventory_categories c
WHERE lower(c.name) = lower(i.category)
  AND i.category_id IS NULL
  AND i.notes = 'DSP seed ingredient';

-- ================================================= 8. RECIPES (one per item)
INSERT INTO recipes (name, type, menu_item_id, yield_quantity, yield_unit, prep_notes)
SELECT m.name, 'menu_item', m.id, 1, 'plate', '__dsp_seed__'
FROM menu_items m
WHERE NOT EXISTS (
  SELECT 1 FROM recipes r WHERE r.menu_item_id = m.id AND r.prep_notes = '__dsp_seed__'
);
-- ============================================ 9. MIGRATION MARKERS (001..038)
INSERT INTO schema_migrations (version) VALUES
  ('001_init'),('002_tables_extra_columns'),('003_expenses_notes_stock'),('004_recipe_bom'),
  ('005_leads_viewed_at'),('006_inventory_expense_upgrade'),('007_inventory_category'),('008_inventory_ledger'),
  ('009_wastage_reason_vocabulary'),('010_list_query_indexes'),('011_unit_conversions'),('012_inventory_categories'),
  ('013_table_floors_types'),('014_payroll'),('015_accounting'),('016_expense_categories'),
  ('017_accounting_hardening'),('018_accounting_numeric'),('019_supplier_ledger'),('020_bank_reconciliation'),
  ('021_table_qr_token'),('022_kitchen_timing'),('023_bill_corrections'),('024_online_orders'),
  ('025_bill_admin'),('026_split_billing'),('027_vat_payable_account'),('028_admin_pos_kot'),
  ('029_order_party'),('030_pos_lifecycle_audit_numbers'),('031_analytics_overview_indexes'),('032_business_days'),
  ('033_business_day_sessions'),('034_opening_cash_movement_accounts'),('035_inventory_business_day_attribution'),
  ('036_savings_deposits'),('037_business_day_stale_ack'),('038_role_permissions')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Sanity checks (run separately if you like):
--   SELECT COUNT(*) FROM menu_categories;   -- 20
--   SELECT COUNT(*) FROM menu_items;        -- 197
--   SELECT COUNT(*) FROM recipes;           -- 197 (empty shells)
--   SELECT COUNT(*) FROM inventory_items;   -- 57 (all quantity 0)
--   SELECT COUNT(*) FROM tables;            -- 12
--   SELECT COUNT(*) FROM business_days;     -- 0 (open one from Admin -> Opening & Closing)
