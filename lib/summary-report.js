import { ensureAccountingSchema } from '@/lib/accounting.js';
import { ensureSavingsSchema } from '@/lib/savings.js';
import { ensureLedgerSchema } from '@/lib/inventory-ledger.js';
import { ensurePayrollSchema } from '@/lib/payroll.js';
import { getItemCostMap } from '@/lib/reports.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (row, key) => Number(row?.[key] || 0);
const BANK_CODES = "'1020','1100','1110','1120','1130','1140'";

async function journalMedia(db, from, to, sources) {
  const placeholders = sources.map(() => '?').join(',');
  const rows = await db.all(`SELECT a.code,COALESCE(SUM(jl.debit-jl.credit),0) AS amount
    FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id JOIN accounts a ON a.id=jl.account_id
    WHERE je.entry_date BETWEEN ? AND ? AND je.source_type IN (${placeholders})
      AND a.code IN ('1010','1020','1100','1110','1120','1130','1140','1300') GROUP BY a.code`, [from, to, ...sources]);
  const out = { cash: 0, bank: 0, credit: 0 };
  for (const r of rows) {
    const value = round2(r.amount);
    if (r.code === '1010') out.cash += value;
    else if (r.code === '1300') out.credit += value;
    else out.bank += value;
  }
  out.cash = round2(out.cash); out.bank = round2(out.bank); out.credit = round2(out.credit);
  out.total = round2(out.cash + out.bank + out.credit);
  return out;
}

async function spending(db, from, to, condition) {
  const rows = await db.all(`SELECT LOWER(COALESCE(payment_method,'cash')) AS method,COALESCE(SUM(amount),0) AS amount,COUNT(*) AS records
    FROM expenses WHERE COALESCE(purchase_date,CAST(expense_date AS TEXT)) BETWEEN ? AND ? AND ${condition}
    GROUP BY LOWER(COALESCE(payment_method,'cash'))`, [from, to]);
  const out = { cash: 0, bank: 0, credit: 0, records: 0 };
  for (const r of rows) {
    const method = r.method;
    if (method === 'cash') out.cash += num(r, 'amount');
    else if (['credit', 'due'].includes(method)) out.credit += num(r, 'amount');
    else out.bank += num(r, 'amount');
    out.records += num(r, 'records');
  }
  out.cash=round2(out.cash); out.bank=round2(out.bank); out.credit=round2(out.credit); out.total=round2(out.cash+out.bank+out.credit);
  return out;
}

async function accountWindow(db, codeSql, from, to) {
  const opening = await db.get(`SELECT COALESCE(SUM(jl.debit-jl.credit),0) AS value FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id JOIN accounts a ON a.id=jl.account_id WHERE a.code IN (${codeSql}) AND je.entry_date < ?`, [from]);
  const movements = await db.all(`SELECT COALESCE(je.source_type,'manual') AS source,COALESCE(SUM(jl.debit),0) AS debit,COALESCE(SUM(jl.credit),0) AS credit FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id JOIN accounts a ON a.id=jl.account_id WHERE a.code IN (${codeSql}) AND je.entry_date BETWEEN ? AND ? GROUP BY COALESCE(je.source_type,'manual')`, [from,to]);
  const bySource = Object.fromEntries(movements.map(r => [r.source,{ debit:round2(r.debit), credit:round2(r.credit), net:round2(num(r,'debit')-num(r,'credit')) }]));
  const open = round2(opening.value); const net = round2(movements.reduce((s,r)=>s+num(r,'debit')-num(r,'credit'),0));
  return { opening: open, movements: bySource, closing: round2(open+net) };
}

export async function buildSummaryReport(db, { start, end }) {
  await Promise.all([ensureAccountingSchema(db), ensureSavingsSchema(db), ensureLedgerSchema(db), ensurePayrollSchema(db)]);
  const [revenue, refundMedia, voidMedia, corrections, ledger, purchases, expenses, salaryRows, cashAccount, bankAccount, savings, saleCategories, purchaseCategories, quantities, settings, costMap] = await Promise.all([
    journalMedia(db,start,end,['bill','bill_supplement']),
    journalMedia(db,start,end,['refund']),
    journalMedia(db,start,end,['reversal']),
    db.get(`SELECT
      COALESCE(SUM(CASE WHEN type='refund' THEN amount ELSE 0 END),0) AS refunds,
      COALESCE(SUM(CASE WHEN type='void' THEN amount ELSE 0 END),0) AS voids,
      SUM(CASE WHEN type='refund' THEN 1 ELSE 0 END) AS refund_count,
      SUM(CASE WHEN type='void' THEN 1 ELSE 0 END) AS void_count
      FROM bill_corrections WHERE date(created_at,'+5 hours','+45 minutes') BETWEEN ? AND ?`,[start,end]).catch(()=>({refunds:0,voids:0,refund_count:0,void_count:0})),
    journalMedia(db,start,end,['credit_collection']),
    spending(db,start,end,`COALESCE(source_type,'')='purchase'`),
    spending(db,start,end,`COALESCE(source_type,'')<>'purchase'`),
    db.all(`SELECT LOWER(COALESCE(method,'cash')) AS method,
                   COALESCE(SUM(amount),0) AS amount,
                   COALESCE(SUM(COALESCE(gross_amount,amount)),0) AS gross_amount,
                   COALESCE(SUM(advance_deduction),0) AS advance_deduction,
                   COUNT(*) AS records
            FROM salary_payments WHERE paid_on BETWEEN ? AND ?
            GROUP BY LOWER(COALESCE(method,'cash'))`,[start,end]),
    accountWindow(db,"'1010'",start,end), accountWindow(db,BANK_CODES,start,end),
    db.get(`SELECT COALESCE(SUM(CASE WHEN source_account='cash' THEN amount ELSE 0 END),0) AS cash,COALESCE(SUM(CASE WHEN source_account='online' THEN amount ELSE 0 END),0) AS online,COUNT(*) AS records FROM savings_deposits WHERE status='active' AND deposit_date BETWEEN ? AND ?`,[start,end]),
    db.all(`SELECT COALESCE(mc.name,'Uncategorised') AS category,SUM(oi.quantity) AS quantity,SUM(COALESCE(oi.subtotal,oi.quantity*oi.price)) AS amount FROM bills b JOIN orders o ON o.id=b.order_id JOIN order_items oi ON oi.order_id=o.id LEFT JOIN menu_items mi ON mi.id=COALESCE(oi.menu_item_id,oi.item_id) LEFT JOIN menu_categories mc ON mc.id=mi.category_id WHERE b.status IN ('paid','partially_paid','refunded') AND date(b.created_at,'+5 hours','+45 minutes') BETWEEN ? AND ? AND COALESCE(oi.status,'') NOT IN ('voided','cancelled') GROUP BY COALESCE(mc.name,'Uncategorised') ORDER BY amount DESC`,[start,end]),
    db.all(`SELECT COALESCE(ic.name,'Uncategorised') AS category,SUM(pi.quantity_received) AS quantity,SUM(pi.line_total) AS amount FROM purchases p JOIN purchase_items pi ON pi.purchase_id=p.id LEFT JOIN inventory_items ii ON ii.id=pi.inventory_item_id LEFT JOIN inventory_categories ic ON ic.id=ii.category_id WHERE COALESCE(p.status,'received')<>'voided' AND COALESCE(p.invoice_date,CAST(p.created_at AS TEXT)) BETWEEN ? AND ? GROUP BY COALESCE(ic.name,'Uncategorised') ORDER BY amount DESC`,[start,end]).catch(()=>[]),
    Promise.all([
      db.get(`SELECT COALESCE(SUM(oi.quantity),0) AS n FROM bills b JOIN order_items oi ON oi.order_id=b.order_id WHERE b.status IN ('paid','partially_paid','refunded') AND date(b.created_at,'+5 hours','+45 minutes') BETWEEN ? AND ? AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')`,[start,end]),
      db.get(`SELECT COALESCE(SUM(pi.quantity_received),0) AS n FROM purchases p JOIN purchase_items pi ON pi.purchase_id=p.id WHERE COALESCE(p.status,'received')<>'voided' AND COALESCE(p.invoice_date,CAST(p.created_at AS TEXT)) BETWEEN ? AND ?`,[start,end]),
      db.get(`SELECT COUNT(*) AS n FROM bills WHERE status IN ('paid','partially_paid','refunded') AND date(created_at,'+5 hours','+45 minutes') BETWEEN ? AND ?`,[start,end]),
      db.get(`SELECT COUNT(*) AS n FROM orders WHERE date(created_at,'+5 hours','+45 minutes') BETWEEN ? AND ?`,[start,end]),
      db.get(`SELECT COUNT(*) AS n FROM kots WHERE date(printed_at,'+5 hours','+45 minutes') BETWEEN ? AND ?`,[start,end]),
    ]),
    db.get(`SELECT MAX(CASE WHEN setting_key='restaurant_name' THEN setting_value END) AS restaurant_name FROM system_settings`).catch(()=>({restaurant_name:'Restaurant'})),
    getItemCostMap(db),
  ]);
  const salary={cash:0,bank:0,advance_deductions:0,gross:0,records:0}; for(const r of salaryRows){if(r.method==='cash')salary.cash+=num(r,'amount');else salary.bank+=num(r,'amount');salary.advance_deductions+=num(r,'advance_deduction');salary.gross+=num(r,'gross_amount');salary.records+=num(r,'records');} salary.cash=round2(salary.cash);salary.bank=round2(salary.bank);salary.advance_deductions=round2(salary.advance_deductions);salary.gross=round2(salary.gross);salary.total=salary.gross;
  const refunded=round2(corrections?.refunds); const voided=round2(corrections?.voids);
  const grossRevenue=round2(revenue.total); const netRevenue=round2(grossRevenue-refunded-voided);
  const received={
    gross_cash:round2(revenue.cash+ledger.cash), gross_bank:round2(revenue.bank+ledger.bank),
    refund_cash:round2(Math.max(0,-refundMedia.cash)), refund_bank:round2(Math.max(0,-refundMedia.bank)),
    void_cash:round2(Math.max(0,-voidMedia.cash)), void_bank:round2(Math.max(0,-voidMedia.bank)),
  };
  received.cash=round2(received.gross_cash-received.refund_cash-received.void_cash);
  received.bank=round2(received.gross_bank-received.refund_bank-received.void_bank);
  received.gross_total=round2(received.gross_cash+received.gross_bank);
  received.total=round2(received.cash+received.bank);
  const estimatedFoodCost=round2((await db.all(`SELECT COALESCE(oi.menu_item_id,oi.item_id) AS item_id,SUM(oi.quantity) AS qty,SUM(COALESCE(oi.subtotal,oi.quantity*oi.price)) AS amount FROM bills b JOIN order_items oi ON oi.order_id=b.order_id WHERE b.status IN ('paid','partially_paid','refunded') AND date(b.created_at,'+5 hours','+45 minutes') BETWEEN ? AND ? AND COALESCE(oi.status,'') NOT IN ('voided','cancelled') GROUP BY COALESCE(oi.menu_item_id,oi.item_id)`,[start,end])).reduce((sum,r)=>sum+(costMap.get(r.item_id)?.cost*num(r,'qty') || num(r,'amount')*.6),0));
  const gross=round2(netRevenue-estimatedFoodCost); const operating=round2(expenses.total+salary.total); const net=round2(gross-operating);
  const exchangeCash=await db.get(`SELECT COALESCE(SUM(jl.debit),0) AS incoming,COALESCE(SUM(jl.credit),0) AS outgoing FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id JOIN accounts a ON a.id=jl.account_id WHERE je.source_type='exchange' AND a.code='1010' AND je.entry_date BETWEEN ? AND ?`,[start,end]);
  const exchangeBank=await db.get(`SELECT COALESCE(SUM(jl.debit),0) AS incoming,COALESCE(SUM(jl.credit),0) AS outgoing FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id JOIN accounts a ON a.id=jl.account_id WHERE je.source_type='exchange' AND a.code IN (${BANK_CODES}) AND je.entry_date BETWEEN ? AND ?`,[start,end]);
  const exchangeFee=await db.get(`SELECT COALESCE(SUM(jl.credit-jl.debit),0) AS amount FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id JOIN accounts a ON a.id=jl.account_id WHERE je.source_type='exchange' AND a.code='4020' AND je.entry_date BETWEEN ? AND ?`,[start,end]);
  return { range:{start,end}, generated_at:new Date().toISOString(), restaurant_name:settings?.restaurant_name||'Restaurant', revenue:{...revenue,gross:grossRevenue,refunds:refunded,voids:voided,net:netRevenue,refund_count:num(corrections,'refund_count'),void_count:num(corrections,'void_count')}, ledger, received, purchases, expenses, salary,
    savings:{cash:round2(savings.cash),online:round2(savings.online),total:round2(num(savings,'cash')+num(savings,'online')),records:num(savings,'records')},
    profit:{revenue:netRevenue,food_cost:estimatedFoodCost,gross,operating,net}, accounts:{cash:cashAccount,bank:bankAccount},
    cash_register:{ cash_in:round2(cashAccount.movements.manual?.debit||0), cash_out:round2(cashAccount.movements.manual?.credit||0), deposit:round2(cashAccount.movements.savings_deposit?.credit||0) },
    sale_categories:saleCategories.map(r=>({category:r.category,quantity:num(r,'quantity'),amount:round2(r.amount)})), purchase_categories:purchaseCategories.map(r=>({category:r.category,quantity:num(r,'quantity'),amount:round2(r.amount)})),
    exchange:{cash:{in:round2(exchangeCash.incoming),out:round2(exchangeCash.outgoing)},bank:{in:round2(exchangeBank.incoming),out:round2(exchangeBank.outgoing)},net:round2(exchangeFee.amount)},
    quantities:{sold:num(quantities[0],'n'),purchased:num(quantities[1],'n'),bills:num(quantities[2],'n'),orders:num(quantities[3],'n'),kots:num(quantities[4],'n'),expenses:expenses.records,salary:salary.records,savings:num(savings,'records')} };
}
