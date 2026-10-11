import { useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Check, Pencil, Plus, Search, Trash2, Wallet, X } from 'lucide-react'
import './anita.css'

export type SaleRecord = { id: string; productName: string; type: 'sale'; quantity: number; unitCost: number; unitPrice: number; date: string; note: string }
export type GcashTransaction = { id: string; date: string; service: string; amount: number; fee: number; customerName: string; phoneNumber: string; reference: string }
type Period = 'day' | 'week' | 'month' | 'year'
type DateRange = { start: string; end: string }
const services = ['Cash in', 'Cash out', 'Load', 'Bills payment', 'Payment']

function todayString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function parseDate(value: string) { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day, 12) }
function dateText(value: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) { return parseDate(value).toLocaleDateString(undefined, options) }
function amountText(value: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) }
function rangeFor(date: string, period: Period): DateRange {
  const start = parseDate(date), end = parseDate(date)
  if (period === 'week') { start.setDate(start.getDate() - (start.getDay() + 6) % 7); end.setTime(start.getTime()); end.setDate(start.getDate() + 6) }
  if (period === 'month') { start.setDate(1); end.setMonth(start.getMonth() + 1, 0) }
  if (period === 'year') { start.setMonth(0, 1); end.setMonth(11, 31) }
  return { start: todayString(start), end: todayString(end) }
}
function moveDate(date: string, period: Period, step: number) {
  const value = parseDate(date)
  if (period === 'day') value.setDate(value.getDate() + step)
  if (period === 'week') value.setDate(value.getDate() + step * 7)
  if (period === 'month') value.setMonth(value.getMonth() + step, 1)
  if (period === 'year') value.setFullYear(value.getFullYear() + step, 0, 1)
  return todayString(value)
}
function formatRange(range: DateRange, period: Period) {
  if (period === 'day') return dateText(range.start)
  if (period === 'month') return dateText(range.start, { month: 'long', year: 'numeric' })
  if (period === 'year') return dateText(range.start, { year: 'numeric' })
  return `${dateText(range.start, { month: 'short', day: 'numeric' })} - ${dateText(range.end)}`
}
function newId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}` }

function PeriodPicker({ period, setPeriod, date, setDate }: { period: Period; setPeriod: (value: Period) => void; date: string; setDate: (value: string) => void }) {
  const range = rangeFor(date, period)
  const dateInputRef = useRef<HTMLInputElement>(null)
  function openCalendar() {
    const input = dateInputRef.current
    if (!input) return
    if (typeof input.showPicker === 'function') input.showPicker()
    else input.click()
  }
  return <div className="period-toolbar"><div className="period-switch" role="group" aria-label="Report period">{(['day', 'week', 'month', 'year'] as Period[]).map((item) => <button key={item} className={period === item ? 'period-option selected' : 'period-option'} onClick={() => setPeriod(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div><div className="period-navigation"><button className="icon-button" title="Previous period" onClick={() => setDate(moveDate(date, period, -1))}><ArrowLeft size={16} /></button><div className="period-date-control"><button type="button" className="period-date-picker" aria-label={`Choose report date, ${formatRange(range, period)}`} onClick={openCalendar}><CalendarDays size={14} /><span>{formatRange(range, period)}</span></button><input ref={dateInputRef} className="period-date-input" type="date" aria-label="Choose report date" value={date} onChange={(event) => setDate(event.target.value)} /></div><button className="icon-button" title="Next period" disabled={date >= todayString()} onClick={() => setDate(moveDate(date, period, 1))}><ArrowRight size={16} /></button><button className="period-today" onClick={() => setDate(todayString())}>Today</button></div></div>
}

export function SalesPage({ sales, onEdit, onDelete }: { sales: SaleRecord[]; onEdit: (id: string) => void; onDelete: (id: string) => void }) {
  const [period, setPeriod] = useState<Period>('day'), [date, setDate] = useState(todayString())
  const range = rangeFor(date, period)
  const rows = sales.filter((sale) => sale.date >= range.start && sale.date <= range.end).sort((a, b) => b.date.localeCompare(a.date))
  const total = rows.reduce((sum, sale) => sum + sale.quantity * sale.unitPrice, 0)
  const costTotal = rows.reduce((sum, sale) => sum + sale.quantity * sale.unitCost, 0)
  const profitTotal = total - costTotal
  const units = rows.reduce((sum, sale) => sum + sale.quantity, 0)
  const daily = new Map<string, { sales: number; costs: number; count: number }>()
  rows.forEach((sale) => {
    const key = period === 'year' ? sale.date.slice(0, 7) : sale.date
    const value = daily.get(key) ?? { sales: 0, costs: 0, count: 0 }
    value.sales += sale.quantity * sale.unitPrice; value.costs += sale.quantity * sale.unitCost; value.count += 1
    daily.set(key, value)
  })
  return <>
    <section className="page-heading inventory-heading"><div><div className="eyebrow"><span className="eyebrow-line" />GROCERY SALES</div><h1>Sales, by the day.</h1><p>Review sales for a day, week, month or year.</p></div></section>
    <PeriodPicker period={period} setPeriod={setPeriod} date={date} setDate={setDate} />
    <section className="sales-summary-grid"><article className="sales-summary-card"><span>Total selling price</span><strong>{amountText(total)}</strong><small>Sales recorded this {period}</small></article><article className="sales-summary-card"><span>Total cost</span><strong>{amountText(costTotal)}</strong><small>Cost of goods sold</small></article><article className="sales-summary-card profit-card"><span>Gross profit</span><strong>{amountText(profitTotal)}</strong><small>Selling price less cost</small></article><article className="sales-summary-card"><span>Units sold</span><strong>{units}</strong><small>Across {rows.length} sale {rows.length === 1 ? 'record' : 'records'}</small></article></section>
    {period !== 'day' && <section className="panel daily-breakdown"><div className="panel-heading"><div><h2>{period === 'year' ? 'Sales by month' : 'Sales by day'}</h2><p>{period === 'year' ? 'Monthly cost, sales and profit for this year.' : `Cost, sales and profit by day this ${period}.`}</p></div></div>{daily.size ? <div className="table-scroll"><table className="inventory-table daily-summary-table sales-daily-table"><thead><tr><th>{period === 'year' ? 'MONTH' : 'DATE'}</th><th>SALE RECORDS</th><th>TOTAL COST</th><th>TOTAL SELLING PRICE</th><th>GROSS PROFIT</th></tr></thead><tbody>{[...daily].sort(([a], [b]) => b.localeCompare(a)).map(([day, sum]) => <tr key={day}><td>{period === 'year' ? dateText(`${day}-01`, { month: 'long', year: 'numeric' }) : dateText(day, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td>{sum.count}</td><td>{amountText(sum.costs)}</td><td>{amountText(sum.sales)}</td><td><strong>{amountText(sum.sales - sum.costs)}</strong></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Total this {period}</td><td>{amountText(costTotal)}</td><td>{amountText(total)}</td><td>{amountText(profitTotal)}</td></tr></tfoot></table></div> : <div className="empty-table"><CalendarDays size={23} /><strong>No sales in this period</strong><span>Inventory sales will be totaled here.</span></div>}</section>}
    <section className="panel sales-record-panel"><div className="panel-heading"><div><h2>Sale records</h2><p>Unit cost and selling price per item.</p></div><span className="record-count">{rows.length} records</span></div>{rows.length ? <div className="table-scroll"><table className="inventory-table sales-table"><thead><tr><th>DATE</th><th>ITEM</th><th>QUANTITY</th><th>UNIT COST</th><th>SELL PRICE</th><th>GROSS PROFIT</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{rows.map((sale) => { const saleCost = sale.quantity * sale.unitCost; const saleTotal = sale.quantity * sale.unitPrice; return <tr key={sale.id}><td>{dateText(sale.date)}</td><td><strong className="item-name">{sale.productName}</strong><span className="subline">{sale.note}</span></td><td>{sale.quantity}</td><td>{amountText(sale.unitCost)}</td><td>{amountText(sale.unitPrice)}</td><td className="profit-value">{amountText(saleTotal - saleCost)}</td><td><div className="row-actions"><button title="Edit sale" onClick={() => onEdit(sale.id)}><Pencil size={14} /></button><button title="Delete sale" onClick={() => onDelete(sale.id)}><Trash2 size={14} /></button></div></td></tr>})}</tbody><tfoot><tr><td colSpan={3}>Period totals</td><td>{amountText(costTotal)}</td><td>{amountText(total)}</td><td>{amountText(profitTotal)}</td><td /></tr></tfoot></table></div> : <div className="empty-table"><CalendarDays size={23} /><strong>No sales for this date</strong><span>Record an item sale to see it here.</span></div>}</section>
  </>
}

export function GcashPage({ records, onSave, onDelete }: {
  records: GcashTransaction[]
  onSave: (record: GcashTransaction) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [period, setPeriod] = useState<Period>('day'), [date, setDate] = useState(todayString()), [query, setQuery] = useState('')
  const [editing, setEditing] = useState<GcashTransaction | null>(null), [adding, setAdding] = useState(false)
  const [saveError, setSaveError] = useState('')
  const range = rangeFor(date, period), selected = records.filter((row) => row.date >= range.start && row.date <= range.end)
  const rows = selected.filter((row) => `${row.customerName} ${row.phoneNumber} ${row.reference} ${row.service}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date))
  const volume = selected.reduce((sum, row) => sum + row.amount, 0), fees = selected.reduce((sum, row) => sum + row.fee, 0)
  const daily = new Map<string, { volume: number; fees: number; count: number }>()
  selected.forEach((row) => { const key = period === 'year' ? row.date.slice(0, 7) : row.date; const item = daily.get(key) ?? { volume: 0, fees: 0, count: 0 }; item.volume += row.amount; item.fees += row.fee; item.count += 1; daily.set(key, item) })

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    const entry: GcashTransaction = { id: editing?.id ?? newId(), date: String(form.get('date')), service: String(form.get('service')), amount: Number(form.get('amount')), fee: Number(form.get('fee') || 0), customerName: String(form.get('customerName')).trim(), phoneNumber: String(form.get('phoneNumber')).trim(), reference: String(form.get('reference')).trim() }
    setSaveError('')
    try {
      await onSave(entry)
      setEditing(null); setAdding(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }
  async function remove(entry: GcashTransaction) {
    if (!window.confirm(`Delete ${entry.service.toLowerCase()} record${entry.reference ? ` ${entry.reference}` : ''}?`)) return
    try {
      await onDelete(entry.id)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  return <>
    <section className="page-heading inventory-heading"><div><div className="eyebrow"><span className="eyebrow-line" />GCASH SERVICES</div><h1>GCash, accounted for.</h1><p>Track cash-in, cash-out, load and bill payments with their fees.</p></div><button className="button button-primary" onClick={() => setAdding(true)}><Plus size={16} />Add GCash transaction</button></section>
    <PeriodPicker period={period} setPeriod={setPeriod} date={date} setDate={setDate} />
    <section className="sales-summary-grid"><article className="sales-summary-card"><span>Transaction amount</span><strong>{amountText(volume)}</strong><small>Money processed this {period}</small></article><article className="sales-summary-card fee-card"><span>Fees collected</span><strong>{amountText(fees)}</strong><small>Your fees this {period}</small></article><article className="sales-summary-card collected-card"><span>Amount + fees</span><strong>{amountText(volume + fees)}</strong><small>{selected.length} GCash transactions</small></article></section>
    <section className="panel gcash-summary-panel">
      <div className="panel-heading"><div><h2>Period totals</h2><p>GCash amounts and fees for this {period}.</p></div></div>
      <div className="table-scroll"><table className="inventory-table gcash-summary-table">
        <thead><tr><th>SUMMARY</th><th>AMOUNT</th><th>DETAILS</th></tr></thead>
        <tbody>
          <tr><td>Transaction amount</td><td>{amountText(volume)}</td><td>Money processed this {period}</td></tr>
          <tr><td>Fees collected</td><td>{amountText(fees)}</td><td>Service fees for this {period}</td></tr>
        </tbody>
        <tfoot><tr><td>Amount + fees</td><td>{amountText(volume + fees)}</td><td>{selected.length} GCash {selected.length === 1 ? 'transaction' : 'transactions'}</td></tr></tfoot>
      </table></div>
    </section>
    {period !== 'day' && <section className="panel daily-breakdown"><div className="panel-heading"><div><h2>{period === 'year' ? 'GCash by month' : 'Daily GCash totals'}</h2><p>{period === 'year' ? 'Monthly amounts and fees this year.' : `Transaction amounts and fees by day this ${period}.`}</p></div></div>{daily.size ? <div className="table-scroll"><table className="inventory-table daily-summary-table gcash-daily-table"><thead><tr><th>{period === 'year' ? 'MONTH' : 'DATE'}</th><th>TRANSACTIONS</th><th>AMOUNT</th><th>FEES</th><th>COLLECTED</th></tr></thead><tbody>{[...daily].sort(([a], [b]) => b.localeCompare(a)).map(([day, sum]) => <tr key={day}><td>{period === 'year' ? dateText(`${day}-01`, { month: 'long', year: 'numeric' }) : dateText(day, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td>{sum.count}</td><td>{amountText(sum.volume)}</td><td>{amountText(sum.fees)}</td><td><strong>{amountText(sum.volume + sum.fees)}</strong></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Total this {period}</td><td>{amountText(volume)}</td><td>{amountText(fees)}</td><td>{amountText(volume + fees)}</td></tr></tfoot></table></div> : <div className="empty-table"><CalendarDays size={23} /><strong>No GCash transactions this {period}</strong><span>Add a GCash transaction to start a record.</span></div>}</section>}
    <section className="panel sales-record-panel gcash-record-panel"><div className="panel-heading gcash-table-heading"><div><h2>Transaction records</h2><p>{rows.length} of {selected.length} records in this period.</p></div><label className="search-box gcash-search"><Search size={15} /><input aria-label="Search GCash transactions" placeholder="Name, number or reference" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>{rows.length ? <div className="table-scroll"><table className="inventory-table gcash-table"><thead><tr><th>DATE</th><th>SERVICE</th><th>CUSTOMER</th><th>NUMBER</th><th>REFERENCE</th><th>AMOUNT</th><th>FEE</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{dateText(row.date, { month: 'short', day: 'numeric' })}</td><td><span className="service-tag">{row.service}</span></td><td>{row.customerName || '-'}</td><td>{row.phoneNumber || '-'}</td><td>{row.reference || '-'}</td><td>{amountText(row.amount)}</td><td>{amountText(row.fee)}</td><td><div className="row-actions"><button title="Edit transaction" onClick={() => setEditing(row)}><Pencil size={14} /></button><button title="Delete transaction" onClick={() => remove(row)}><Trash2 size={14} /></button></div></td></tr>)}</tbody><tfoot><tr><td colSpan={5}>Period totals</td><td>{amountText(volume)}</td><td>{amountText(fees)}</td><td /></tr></tfoot></table></div> : <div className="empty-table"><Wallet size={24} /><strong>{query ? 'No matching transactions' : 'No GCash records this day'}</strong><span>{query ? 'Search another name, number or reference.' : 'Add a GCash transaction to begin tracking.'}</span>{!query && <button className="button button-secondary" onClick={() => setAdding(true)}><Plus size={15} />Add transaction</button>}</div>}</section>
    {saveError && <p className="auth-error" role="alert">{saveError}</p>}
    {(adding || editing) && <GcashDialog record={editing} error={saveError} onClose={() => { setAdding(false); setEditing(null); setSaveError('') }} onSubmit={save} />}
  </>
}

function GcashDialog({ record, error, onClose, onSubmit }: { record: GcashTransaction | null; error: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void> }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="gcash-dialog-title"><div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-line" />GCASH RECORD</div><h2 id="gcash-dialog-title">{record ? 'Edit transaction' : 'Add transaction'}</h2><p>Enter the amount and service fee.</p></div><button className="icon-button" type="button" title="Close" onClick={onClose}><X size={18} /></button></div>{error && <p className="auth-error" role="alert">{error}</p>}<form onSubmit={onSubmit}><div className="form-grid"><label className="field">Date<input name="date" type="date" defaultValue={record?.date ?? todayString()} required /></label><label className="field">Service<select name="service" defaultValue={record?.service ?? services[0]}>{services.map((service) => <option key={service}>{service}</option>)}</select></label><label className="field">Transaction amount<input name="amount" type="number" min="0.01" step="0.01" defaultValue={record?.amount} placeholder="0.00" required autoFocus /></label><label className="field">Fee collected<input name="fee" type="number" min="0" step="0.01" defaultValue={record?.fee ?? 0} required /></label><label className="field">Customer name <span className="optional-label">optional</span><input name="customerName" defaultValue={record?.customerName} placeholder="Name" /></label><label className="field">Phone number <span className="optional-label">optional</span><input name="phoneNumber" type="tel" defaultValue={record?.phoneNumber} placeholder="09XX XXX XXXX" /></label><label className="field full-field">Reference number <span className="optional-label">optional</span><input name="reference" defaultValue={record?.reference} placeholder="Transaction reference" /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">{record ? <Check size={15} /> : <Plus size={15} />}{record ? 'Save changes' : 'Save transaction'}</button></div></form></section></div>
}
