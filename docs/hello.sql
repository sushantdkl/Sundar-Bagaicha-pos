SELECT order_number, status, table_number FROM orders ORDER BY id;
-- expect only O013, O014

SELECT COUNT(*) AS busy
FROM tables
WHERE status <> 'available' OR current_order_id IS NOT NULL;
-- expect 0