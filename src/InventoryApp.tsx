import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  LayoutDashboard,
  Menu,
  Package,
  Plus,
  Search,
  ShoppingBasket,
  TrendingUp,
  Wallet,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { GcashPage, SalesPage, type GcashTransaction } from './SalesPages.tsx'
import type { Movement, Product } from './types.ts'
import {
  createProduct as saveNewProduct,
  deleteMovement as removeMovement,
  deleteGcashRecord,
  importLegacyRecords,
  loadInventory,
  recordMovement as saveMovement,
  saveGcashRecord,
  updateMovement as saveUpdatedMovement,
  updateProduct as saveUpdatedProduct,
} from './lib/inventoryDatabase.ts'
import { supabase } from './lib/supabase.ts'
import type { Session } from '@supabase/supabase-js'
import './anita.css'

type View = 'overview' | 'inventory' | 'activity' | 'sales' | 'gcash'
type InventoryFilter = 'all' | 'low' | 'expiring'
type Dialog = { type: 'product'; product?: Product } | { type: 'movement'; productId: string; movement: 'purchase' | 'sale' } | null
type LegacyRecords = { products: Product[]; movements: Movement[]; gcashRecords: GcashTransaction[] }

function readLegacyList<T>(key: string): T[] {
  const stored = localStorage.getItem(key)
  if (!stored) return []
  const parsed: unknown = JSON.parse(stored)
  if (!Array.isArray(parsed)) throw new Error(`Saved data in ${key} is not a list`)
  return parsed as T[]
}

function localDate(offset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateLabel(value: string) {
  if (!value) return 'No date set'
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(value: string) {
  if (!value) return Number.POSITIVE_INFINITY
  const [year, month, day] = value.split('-').map(Number)
  const expiry = Date.UTC(year, month - 1, day)
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.ceil((expiry - today) / 86_400_000)
}

function money(value: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function App() {
  const [products, setProducts] = useState<Product[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [gcashRecords, setGcashRecords] = useState<GcashTransaction[]>([])
  const [view, setView] = useState<View>('overview')
  const [filter, setFilter] = useState<InventoryFilter>('all')
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [notice, setNotice] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [editingMovement, setEditingMovement] = useState<Movement | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [legacyRecords, setLegacyRecords] = useState<LegacyRecords | null>(null)
  const userId = session?.user.id

  useEffect(() => {
    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession)
        if (!nextSession) {
          setProducts([])
          setMovements([])
          setGcashRecords([])
          setLegacyRecords(null)
        }
      }
    })
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setNotice(`Could not check sign-in status: ${error.message}`)
      setSession(data.session)
      setAuthReady(true)
    }).catch((error: unknown) => {
      if (active) {
        setNotice(`Could not connect to Supabase: ${error instanceof Error ? error.message : String(error)}`)
        setAuthReady(true)
      }
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!authReady || !userId) return
    let active = true
    loadInventory().then((data) => {
      if (!active) return
      setProducts(data.products)
      setMovements(data.movements)
      setGcashRecords(data.gcashRecords)
      setLegacyRecords(null)
      if (!data.products.length && !data.movements.length && !data.gcashRecords.length) {
        try {
          const oldRecords = {
            products: readLegacyList<Product>('anita-products-v1'),
            movements: readLegacyList<Movement>('anita-movements-v1'),
            gcashRecords: readLegacyList<GcashTransaction>('anita-gcash-v1'),
          }
          if (oldRecords.products.length || oldRecords.movements.length || oldRecords.gcashRecords.length) {
            setLegacyRecords(oldRecords)
          }
        } catch (error) {
          setNotice(`Could not read old records from this device: ${error instanceof Error ? error.message : String(error)}`)
        }
      } else {
        setLegacyRecords(null)
      }
      setLoadedUserId(userId)
    }).catch((error: unknown) => {
      if (!active) return
      setProducts([])
      setMovements([])
      setGcashRecords([])
      setLegacyRecords(null)
      setNotice(`Could not load your records: ${error instanceof Error ? error.message : String(error)}`)
      setLoadedUserId(userId)
    })
    return () => { active = false }
  }, [authReady, userId])

  const lowStock = useMemo(() => products.filter((product) => product.quantity <= product.reorderLevel), [products])
  const expiring = useMemo(() => products.filter((product) => daysUntil(product.expiryDate) <= 14), [products])
  const today = localDate()
  const todayPurchases = movements.filter((movement) => movement.date === today && movement.type === 'purchase')
  const todayGcash = gcashRecords.filter((record) => record.date === today)
  const todayGcashAmount = todayGcash.reduce((sum, record) => sum + record.amount, 0)
  const todayGcashFees = todayGcash.reduce((sum, record) => sum + record.fee, 0)
  const inventoryValue = products.reduce((total, product) => total + product.quantity * product.cost, 0)
  const todayPurchaseUnits = todayPurchases.reduce((total, movement) => total + movement.quantity, 0)

  const visibleProducts = products.filter((product) => {
    const matchesQuery = `${product.name} ${product.category}`.toLowerCase().includes(query.toLowerCase())
    const matchesCategory = categoryFilter === 'all' || product.category === categoryFilter
    const matchesFilter = filter === 'all'
      || (filter === 'low' && product.quantity <= product.reorderLevel)
      || (filter === 'expiring' && daysUntil(product.expiryDate) <= 14)
    return matchesQuery && matchesCategory && matchesFilter
  })
  const categories = [...new Set(products.map((product) => product.category))].sort((left, right) => left.localeCompare(right))

  const recentMovements = [...movements].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 6)

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signUp(email: string, password: string) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    if (!data.session) {
      setNotice('Account created. Check your email to confirm it, then sign in.')
    }
  }

  async function persistGcashRecord(record: GcashTransaction) {
    try {
      await saveGcashRecord(record)
      setGcashRecords((current) => current.some((item) => item.id === record.id)
        ? current.map((item) => item.id === record.id ? record : item)
        : [record, ...current])
    } catch (error) {
      setNotice(`Could not save GCash transaction: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  async function removeGcashRecord(id: string) {
    try {
      await deleteGcashRecord(id)
      setGcashRecords((current) => current.filter((record) => record.id !== id))
    } catch (error) {
      setNotice(`Could not delete GCash transaction: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  async function importRecordsFromThisDevice() {
    if (!legacyRecords) return
    if (!window.confirm('Import the records previously saved in this browser into your shop database?')) return
    setIsImporting(true)
    try {
      await importLegacyRecords(legacyRecords.products, legacyRecords.movements, legacyRecords.gcashRecords)
      const data = await loadInventory()
      setProducts(data.products)
      setMovements(data.movements)
      setGcashRecords(data.gcashRecords)
      setLegacyRecords(null)
      setNotice('This device’s records were imported into your shop database')
    } catch (error) {
      setNotice(`Could not import records: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsImporting(false)
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) setNotice(`Could not sign out: ${error.message}`)
  }

  if (!authReady || (session && loadedUserId !== session.user.id)) {
    return <div className="auth-screen"><p>Connecting to your shop database...</p></div>
  }

  if (!session) {
    return <AuthPanel onSignIn={signIn} onSignUp={signUp} notice={notice} />
  }

  async function exportWorkbook() {
    const XLSX = await import('xlsx')
    const workbook = XLSX.utils.book_new()
    const productRows = products.map((product) => ({
      Item: product.name,
      Category: product.category,
      Quantity: product.quantity,
      Unit: product.unit,
      'Unit cost': product.cost,
      'Selling price': product.price,
      'Stock value': product.quantity * product.cost,
      'Reorder at': product.reorderLevel,
      'Expiration date': product.expiryDate,
    }))
    const movementRows = [...movements].sort((left, right) => right.date.localeCompare(left.date)).map((movement) => ({
      Date: movement.date,
      Item: movement.productName,
      Type: movement.type === 'purchase' ? 'Stock received' : 'Sale',
      Quantity: movement.quantity,
      'Unit price': movement.unitPrice,
      Total: movement.quantity * movement.unitPrice,
      Note: movement.note,
    }))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(productRows), 'Inventory')
    const gcashRows = gcashRecords.map((record) => ({
      Date: record.date, Service: record.service, Amount: record.amount, Fee: record.fee,
      'Amount + fee': record.amount + record.fee, 'Customer name': record.customerName,
      'Phone number': record.phoneNumber, Reference: record.reference,
    }))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(movementRows), 'Movements')
    const salesRows = movements.filter((movement) => movement.type === 'sale').map((movement) => {
      const unitCost = movement.unitCost ?? products.find((product) => product.id === movement.productId)?.cost ?? 0
      const totalCost = movement.quantity * unitCost
      const totalSellingPrice = movement.quantity * movement.unitPrice
      return { Date: movement.date, Item: movement.productName, Quantity: movement.quantity, 'Unit cost': unitCost, 'Total cost': totalCost, 'Unit selling price': movement.unitPrice, 'Total selling price': totalSellingPrice, 'Gross profit': totalSellingPrice - totalCost, Note: movement.note }
    })
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(salesRows), 'Sales')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(gcashRows), 'GCash')
    XLSX.writeFile(workbook, `anita-inventory-${today}.xlsx`)
    setNotice('Excel workbook downloaded')
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const product: Product = {
      id: makeId(),
      name: String(form.get('name')).trim(),
      category: String(form.get('category')).trim() || 'Other',
      quantity: Number(form.get('quantity')),
      unit: String(form.get('unit')).trim() || 'item',
      cost: Number(form.get('cost')),
      price: Number(form.get('price')),
      reorderLevel: Number(form.get('reorderLevel')),
      expiryDate: String(form.get('expiryDate')),
    }
    const openingMovement = product.quantity > 0 ? {
        id: makeId(), productId: product.id, productName: product.name, type: 'purchase',
        quantity: product.quantity, unitPrice: product.cost, date: today, note: 'Opening stock',
      } satisfies Movement : undefined
    try {
      await saveNewProduct(product, openingMovement)
    } catch (error) {
      setNotice(`Could not add item: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    setProducts((current) => [product, ...current])
    if (openingMovement) {
      setMovements((current) => [openingMovement, ...current])
    }
    setDialog(null)
    setNotice(`${product.name} added to inventory`)
  }
  async function editProduct(event: FormEvent<HTMLFormElement>, original: Product) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const updated: Product = {
      ...original,
      name: String(form.get('name')).trim(),
      category: String(form.get('category')).trim() || 'Other',
      unit: String(form.get('unit')).trim() || 'item',
      cost: Number(form.get('cost')),
      price: Number(form.get('price')),
      reorderLevel: Number(form.get('reorderLevel')),
      expiryDate: String(form.get('expiryDate')),
    }
    try {
      await saveUpdatedProduct(updated)
    } catch (error) {
      setNotice(`Could not update item: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    setProducts((current) => current.map((product) => product.id === original.id ? updated : product))
    setDialog(null)
    setNotice(`${updated.name} updated`)
  }


  async function recordMovement(event: FormEvent<HTMLFormElement>, product: Product, movementType: 'purchase' | 'sale') {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const quantity = Number(form.get('quantity'))
    const unitPrice = Number(form.get('unitPrice'))
    if (movementType === 'sale' && quantity > product.quantity) {
      setNotice(`Only ${product.quantity} ${product.unit} available`)
      return
    }
    const movement: Movement = {
      id: makeId(), productId: product.id, productName: product.name, type: movementType,
      unitCost: movementType === 'sale' ? product.cost : undefined,
      quantity, unitPrice, date: today, note: String(form.get('note')).trim() || (movementType === 'purchase' ? 'Stock received' : 'Counter sale'),
    }
    const expiryDate = movementType === 'purchase' && form.get('expiryDate') ? String(form.get('expiryDate')) : undefined
    try {
      await saveMovement(movement, expiryDate)
    } catch (error) {
      setNotice(`Could not record stock activity: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    setProducts((current) => current.map((item) => item.id === product.id ? {
      ...item,
      quantity: item.quantity + (movementType === 'purchase' ? quantity : -quantity),
      cost: movementType === 'purchase' ? unitPrice : item.cost,
      expiryDate: expiryDate ?? item.expiryDate,
    } : item))
    setMovements((current) => [movement, ...current])
    setDialog(null)
    setNotice(movementType === 'purchase' ? `${quantity} ${product.unit} added to stock` : `Sale recorded for ${product.name}`)
  }

  function openInventory(filterValue: InventoryFilter = 'all') {
    setFilter(filterValue)
    setView('inventory')
    setMobileNavOpen(false)
  }

  async function updateMovement(event: FormEvent<HTMLFormElement>, original: Movement) {
    event.preventDefault()
    const product = products.find((item) => item.id === original.productId)
    if (!product) return
    const form = new FormData(event.currentTarget)
    const updated: Movement = {
      ...original,
      quantity: Number(form.get('quantity')),
      unitCost: original.type === 'sale' ? Number(form.get('unitCost') || original.unitCost || product.cost) : undefined,
      unitPrice: Number(form.get('unitPrice')),
      date: String(form.get('date')),
      note: String(form.get('note')).trim(),
    }
    const effect = (movement: Movement) => movement.type === 'purchase' ? movement.quantity : -movement.quantity
    const nextQuantity = product.quantity - effect(original) + effect(updated)
    if (nextQuantity < 0) {
      setNotice(`Cannot reduce ${product.name} below zero stock`)
      return
    }
    const nextMovements = movements.map((movement) => movement.id === original.id ? updated : movement)
    const latestPurchase = nextMovements
      .filter((movement) => movement.productId === product.id && movement.type === 'purchase')
      .sort((left, right) => right.date.localeCompare(left.date))[0]
    try {
      await saveUpdatedMovement(updated)
    } catch (error) {
      setNotice(`Could not update stock activity: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    setProducts((current) => current.map((item) => item.id === product.id ? {
      ...item,
      quantity: nextQuantity,
      cost: latestPurchase?.unitPrice ?? item.cost,
    } : item))
    setMovements(nextMovements)
    setEditingMovement(null)
    setNotice('Stock activity updated')
  }

  async function deleteMovement(movementId: string) {
    const movement = movements.find((item) => item.id === movementId)
    if (!movement) return
    if (!window.confirm(`Delete this ${movement.type === 'sale' ? 'sale' : 'stock receipt'} for ${movement.productName}?`)) return
    const product = products.find((item) => item.id === movement.productId)
    const effect = movement.type === 'purchase' ? movement.quantity : -movement.quantity
    const nextQuantity = product ? product.quantity - effect : 0
    if (product && nextQuantity < 0) {
      setNotice(`Cannot remove this purchase; only ${product.quantity} ${product.unit} remain`)
      return
    }
    try {
      await removeMovement(movementId)
    } catch (error) {
      setNotice(`Could not delete stock activity: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const nextMovements = movements.filter((item) => item.id !== movement.id)
    const latestPurchase = nextMovements
      .filter((item) => item.productId === movement.productId && item.type === 'purchase')
      .sort((left, right) => right.date.localeCompare(left.date))[0]
    setProducts((current) => current.map((item) => item.id === movement.productId ? {
      ...item,
      quantity: nextQuantity,
      cost: movement.type === 'purchase' ? latestPurchase?.unitPrice ?? item.cost : item.cost,
    } : item))
    setMovements(nextMovements)
    setNotice('Stock activity deleted')
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setView('overview') }}>
          <span className="brand-mark"><ShoppingBasket size={21} strokeWidth={2.2} /></span>
          <span className="brand-name">Anita<small>Store Records</small></span>
        </a>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className={view === 'overview' ? 'nav-link active' : 'nav-link'} onClick={() => { setView('overview'); setMobileNavOpen(false) }}><LayoutDashboard size={18} />Overview</button>
          <button className={view === 'inventory' ? 'nav-link active' : 'nav-link'} onClick={() => openInventory()}><Package size={18} />Inventory<span className="nav-count">{products.length}</span></button>
          <button className={view === 'activity' ? 'nav-link active' : 'nav-link'} onClick={() => { setView('activity'); setMobileNavOpen(false) }}><ArrowDownLeft size={18} />Stock activity</button>
          <button className={view === 'sales' ? 'nav-link active' : 'nav-link'} onClick={() => { setView('sales'); setMobileNavOpen(false) }}><TrendingUp size={18} />Sales</button>
          <button className={view === 'gcash' ? 'nav-link active' : 'nav-link'} onClick={() => { setView('gcash'); setMobileNavOpen(false) }}><Wallet size={18} />GCash</button>
        </nav>
        <div className="side-label side-label-alerts">REMINDERS</div>
        <button className="alert-link" onClick={() => openInventory('low')}><span className="alert-dot low-dot" />Low stock<span className="alert-count">{lowStock.length}</span></button>
        <button className="alert-link" onClick={() => openInventory('expiring')}><span className="alert-dot expiry-dot" />Expiring soon<span className="alert-count">{expiring.length}</span></button>
        <div className="sidebar-bottom">
          <div className="storage-indicator"><span className="storage-pulse" /><span>Connected to database</span><Check size={14} /></div>
          <p>Records sync across devices using your shop account.</p>
          <button className="sign-out-button" onClick={() => { void signOut() }}>Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" title="Open menu" onClick={() => setMobileNavOpen((open) => !open)}><Menu size={20} /></button>
          <div className="breadcrumbs">Anita <span>/</span> <strong>{view === 'overview' ? 'Overview' : view === 'inventory' ? 'Inventory' : 'Stock activity'}</strong></div>
          <div className="topbar-actions">
            {!['sales', 'gcash'].includes(view) && <span className="today-label"><CalendarClock size={15} />{dateLabel(today)}</span>}
            <button className="button button-secondary export-button" onClick={exportWorkbook}><Download size={16} />Export Excel</button>
            <button className="button button-primary add-button" onClick={() => setDialog({ type: 'product' })}><Plus size={17} />Add item</button>
          </div>
        </header>

        <div className="page-content">
          {legacyRecords && <div className="legacy-import-banner"><div><strong>Records from this browser are available</strong><span>Import them to the shop database so they sync with your other devices.</span></div><button className="button button-secondary" disabled={isImporting} onClick={() => { void importRecordsFromThisDevice() }}>{isImporting ? 'Importing...' : 'Import records'}</button></div>}
          {view === 'overview' && <>
            <section className="page-heading">
              <div><div className="eyebrow"><span className="eyebrow-line" />YOUR STORE, IN GOOD ORDER</div><h1>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}.</h1><p>A clear view of what is on your shelves today.</p></div>
              <button className="button button-soft" onClick={() => { setView('inventory'); setFilter('all') }}><Boxes size={16} />View inventory<ArrowUpRight size={15} /></button>
            </section>

            <section className="metric-grid" aria-label="Inventory summary">
              <article className="metric-card metric-green"><div className="metric-top"><span>Items in catalog</span><span className="metric-icon"><Package size={17} /></span></div><div className="metric-number">{products.length}<span className="metric-unit">products</span></div><div className="metric-foot">Across {new Set(products.map((product) => product.category)).size} categories</div></article>
              <article className="metric-card metric-ink"><div className="metric-top"><span>Stock on hand</span><span className="metric-icon"><Boxes size={17} /></span></div><div className="metric-number">{products.reduce((total, product) => total + product.quantity, 0)}<span className="metric-unit">units</span></div><div className="metric-foot">Cost value <strong>{money(inventoryValue)}</strong></div></article>
              <button className="metric-card metric-warning" onClick={() => openInventory('low')}><div className="metric-top"><span>Running low</span><span className="metric-icon"><CircleAlert size={17} /></span></div><div className="metric-number">{lowStock.length}<span className="metric-unit">items</span></div><div className="metric-foot">At or below reorder level <ArrowUpRight size={14} /></div></button>
              <button className="metric-card metric-peach" onClick={() => openInventory('expiring')}><div className="metric-top"><span>Expiry watch</span><span className="metric-icon"><Clock3 size={17} /></span></div><div className="metric-number">{expiring.length}<span className="metric-unit">items</span></div><div className="metric-foot">Within the next 14 days <ArrowUpRight size={14} /></div></button>
            </section>

            <section className="today-strip"><div className="today-icon"><TrendingUp size={19} /></div><div><strong>{todayPurchaseUnits} units received today</strong><span>{todayPurchases.length ? `${todayPurchases.length} purchase ${todayPurchases.length === 1 ? 'entry' : 'entries'} added to your activity` : 'No stock received yet today'}</span></div><button onClick={() => setDialog({ type: 'movement', productId: products[0]?.id ?? '', movement: 'purchase' })} disabled={!products.length}><Plus size={15} />Record purchase</button></section>
            <section className="today-strip gcash-overview-strip"><div className="today-icon"><Wallet size={18} /></div><div className="gcash-overview-copy"><strong>GCash activity today</strong><span>{todayGcash.length} {todayGcash.length === 1 ? 'transaction' : 'transactions'} recorded</span></div><div className="gcash-overview-figures"><span><small>Processed</small><strong>{money(todayGcashAmount)}</strong></span><span><small>Fees</small><strong>{money(todayGcashFees)}</strong></span><span className="gcash-overview-total"><small>Amount + fees</small><strong>{money(todayGcashAmount + todayGcashFees)}</strong></span></div><button onClick={() => setView('gcash')}><ArrowUpRight size={15} />View GCash</button></section>

            <section className="dashboard-columns">
              <div className="panel inventory-panel">
                <div className="panel-heading"><div><h2>Stock overview</h2><p>The items that need your eye first.</p></div><button className="text-link" onClick={() => { setView('inventory'); setFilter('all') }}>All items <ArrowUpRight size={14} /></button></div>
                {products.length ? <div className="stock-list">{[...products].sort((a, b) => Number(a.quantity > a.reorderLevel) - Number(b.quantity > b.reorderLevel)).slice(0, 5).map((product) => <StockRow key={product.id} product={product} onReceive={() => setDialog({ type: 'movement', productId: product.id, movement: 'purchase' })} />)}</div> : <EmptyState title="Your shelves are waiting" detail="Add your first grocery item to begin tracking stock." action="Add first item" onAction={() => setDialog({ type: 'product' })} />}
              </div>
              <div className="panel activity-panel">
                <div className="panel-heading"><div><h2>Recent activity</h2><p>Purchases and sales, in one place.</p></div><button className="icon-button small-icon" title="View all activity" onClick={() => setView('activity')}><ArrowUpRight size={16} /></button></div>
                {recentMovements.length ? <div className="activity-list">{recentMovements.slice(0, 5).map((movement) => <ActivityRow key={movement.id} movement={movement} />)}</div> : <EmptyState title="No stock activity yet" detail="Purchases and sales will appear here." />}
              </div>
            </section>
            <div className="page-note"><span className="note-spark">?</span>Little by little, every shelf accounted for.</div>
          </>}

          {view === 'inventory' && <>
            <section className="page-heading inventory-heading"><div><div className="eyebrow"><span className="eyebrow-line" />PRODUCT CATALOG</div><h1>Your inventory.</h1><p>Keep quantities, prices and best-before dates up to date.</p></div><button className="button button-primary" onClick={() => setDialog({ type: 'product' })}><Plus size={17} />Add item</button></section>
            <div className="inventory-toolbar"><div className="inventory-search-controls"><div className="search-box"><Search size={17} /><input aria-label="Search inventory" placeholder="Search items or categories..." value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>/</kbd></div><label className="category-filter"><span>Category</span><select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select><ChevronDown size={14} /></label></div><div className="filter-tabs" role="group" aria-label="Filter inventory">{(['all', 'low', 'expiring'] as InventoryFilter[]).map((filterOption) => <button key={filterOption} className={filter === filterOption ? 'filter-tab selected' : 'filter-tab'} onClick={() => setFilter(filterOption)}>{filterOption === 'all' ? 'All items' : filterOption === 'low' ? `Low stock = ${lowStock.length}` : `Expiring = ${expiring.length}`}</button>)}</div></div>
            <div className="panel table-panel"><div className="table-summary"><span><strong>{visibleProducts.length}</strong> {visibleProducts.length === 1 ? 'item' : 'items'} shown</span><span className="table-summary-right">Prices in your local currency</span></div>
              <div className="table-scroll"><table className="inventory-table"><thead><tr><th>ITEM</th><th>ON HAND</th><th>UNIT COST</th><th>SELL PRICE</th><th>EXPIRATION</th><th>STATUS</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{visibleProducts.map((product) => <InventoryTableRow key={product.id} product={product} onReceive={() => setDialog({ type: 'movement', productId: product.id, movement: 'purchase' })} onSell={() => setDialog({ type: 'movement', productId: product.id, movement: 'sale' })} onEdit={() => setDialog({ type: 'product', product })} />)}</tbody></table></div>
              {!visibleProducts.length && <div className="empty-table"><Package size={24} /><strong>No matching items</strong><span>Try another search or add a product.</span></div>}
            </div>
          </>}

          {view === 'activity' && <>
            <section className="page-heading inventory-heading"><div><div className="eyebrow"><span className="eyebrow-line" />MOVEMENT LOG</div><h1>Stock activity.</h1><p>A dated record of everything received and sold.</p></div><button className="button button-primary" onClick={() => setDialog({ type: 'movement', productId: products[0]?.id ?? '', movement: 'purchase' })} disabled={!products.length}><Plus size={17} />Record purchase</button></section>
            <div className="panel log-panel"><div className="table-scroll"><table className="inventory-table movement-table"><thead><tr><th>DATE</th><th>ITEM</th><th>ACTIVITY</th><th>QUANTITY</th><th>UNIT COST</th><th>SALE PRICE</th><th>TOTAL</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{[...movements].sort((a, b) => b.date.localeCompare(a.date)).map((movement) => <tr key={movement.id}><td>{dateLabel(movement.date)}</td><td><strong className="item-name">{movement.productName}</strong><span className="subline">{movement.note}</span></td><td><span className={`movement-badge ${movement.type}`}>{movement.type === 'purchase' ? <><ArrowDownLeft size={13} />Stock in</> : <><ArrowUpRight size={13} />Sale</>}</span></td><td>{movement.quantity}</td><td>{money(movement.unitCost ?? movement.unitPrice)}</td><td>{movement.type === 'sale' ? money(movement.unitPrice) : '-'}</td><td><strong>{money(movement.quantity * movement.unitPrice)}</strong></td><td><div className="row-actions"><button title="Edit activity" onClick={() => setEditingMovement(movement)}><Pencil size={14} /></button><button title="Delete activity" onClick={() => deleteMovement(movement.id)}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div>{!movements.length && <div className="empty-table"><Clock3 size={24} /><strong>No activity recorded</strong><span>When you receive stock or record a sale, it will show here.</span></div>}</div>
          </>}
          {view === 'sales' && <SalesPage sales={movements.filter((movement): movement is Movement & { type: 'sale' } => movement.type === 'sale').map((movement) => ({ ...movement, unitCost: movement.unitCost ?? products.find((product) => product.id === movement.productId)?.cost ?? 0 }))} onEdit={(id) => setEditingMovement(movements.find((movement) => movement.id === id) ?? null)} onDelete={deleteMovement} />}
          {view === 'gcash' && <GcashPage records={gcashRecords} onSave={persistGcashRecord} onDelete={removeGcashRecord} />}
        </div>
        <footer className="main-footer"><span>ANITA'S INVENTORY</span><span>Synced to your shop account</span></footer>
      </main>

      {notice && <div className="toast" role="status"><span className="toast-check"><Check size={14} /></span>{notice}<button title="Dismiss" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {dialog?.type === 'product' && <ProductDialog product={dialog.product} onClose={() => setDialog(null)} onSubmit={(event) => dialog.product ? editProduct(event, dialog.product) : addProduct(event)} />}
      {editingMovement && <EditMovementDialog movement={editingMovement} product={products.find((item) => item.id === editingMovement.productId)} onClose={() => setEditingMovement(null)} onSubmit={updateMovement} />}
      {dialog?.type === 'movement' && <MovementDialog dialog={dialog} products={products} onClose={() => setDialog(null)} onSubmit={recordMovement} />}
    </div>
  )
}

function AuthPanel({ onSignIn, onSignUp, notice }: {
  onSignIn: (email: string, password: string) => Promise<void>
  onSignUp: (email: string, password: string) => Promise<void>
  notice: string
}) {
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email')).trim()
    const password = String(form.get('password'))
    try {
      await (creatingAccount ? onSignUp(email, password) : onSignIn(email, password))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-screen">
    <form className="auth-card" onSubmit={submit}>
      <div className="eyebrow"><span className="eyebrow-line" />ANITA'S INVENTORY</div>
      <h1>{creatingAccount ? 'Create your shop account.' : 'Sign in to your shop.'}</h1>
      <p>Your inventory and transaction records are stored securely in your Supabase database.</p>
      {notice && <p className="auth-message" role="status">{notice}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <label>Email address<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password<input name="password" type="password" minLength={6} autoComplete={creatingAccount ? 'new-password' : 'current-password'} required /></label>
      <button className="button button-primary auth-submit" type="submit" disabled={busy}>
        {busy ? 'Please wait...' : creatingAccount ? 'Create account' : 'Sign in'}
      </button>
      <button className="auth-toggle" type="button" onClick={() => { setCreatingAccount((current) => !current); setError('') }}>
        {creatingAccount ? 'Already have an account? Sign in' : 'First time here? Create the shop account'}
      </button>
      <small>Use this same account on each device that needs access to the shop records.</small>
    </form>
  </main>
}

function ProductDialog({ product, onClose, onSubmit }: {
  product?: Product
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const units = ['piece', 'pack', 'bottle', 'box', 'kg', 'g', 'liter', 'tray', 'loaf', 'cup']
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
      <div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{product ? 'EDIT PRODUCT' : 'NEW PRODUCT'}</div><h2 id="product-modal-title">{product ? 'Edit item' : 'Add an item'}</h2><p>{product ? 'Update item details. Use stock actions to change quantity.' : 'Set up its shelf details and starting quantity.'}</p></div><button type="button" className="icon-button" title="Close" onClick={onClose}><X size={19} /></button></div>
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <label className="field full-field">Item name<input name="name" defaultValue={product?.name} placeholder="e.g. Whole wheat bread" required autoFocus /></label>
          <label className="field">Category<input name="category" defaultValue={product?.category} placeholder="e.g. Bakery" /></label>
          <label className="field">Unit<select name="unit" defaultValue={product?.unit ?? 'piece'}>{!units.includes(product?.unit ?? '') && product?.unit && <option value={product.unit}>{product.unit}</option>}{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select><ChevronDown className="select-chevron" size={14} /></label>
          {product ? <label className="field">On hand<input value={`${product.quantity} ${product.unit}`} readOnly /><span className="field-hint">Change with Receive or Sell.</span></label> : <label className="field">Starting quantity<input name="quantity" type="number" min="0" step="any" defaultValue="0" required /></label>}
          <label className="field">Reorder when at<input name="reorderLevel" type="number" min="0" step="any" defaultValue={product?.reorderLevel ?? 5} required /></label>
          <label className="field">Unit cost<input name="cost" type="number" min="0" step="0.01" defaultValue={product?.cost} placeholder="0.00" required /></label>
          <label className="field">Selling price<input name="price" type="number" min="0" step="0.01" defaultValue={product?.price} placeholder="0.00" required /></label>
          <label className="field full-field">Expiration date <span className="optional-label">optional</span><input name="expiryDate" type="date" defaultValue={product?.expiryDate} /></label>
        </div>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary">{product ? <Check size={15} /> : <Plus size={16} />}{product ? 'Save changes' : 'Save item'}</button></div>
      </form>
    </section>
  </div>
}

function StockRow({ product, onReceive }: { product: Product; onReceive: () => void }) {
  const isLow = product.quantity <= product.reorderLevel
  return <div className="stock-row"><span className={`product-avatar avatar-${product.category.toLowerCase().replace(/[^a-z]/g, '')}`}>{product.name.slice(0, 1).toUpperCase()}</span><div className="stock-product"><strong>{product.name}</strong><span>{product.category}</span></div><div className="stock-quantity"><strong>{product.quantity}</strong><span>{product.unit} on hand</span></div><span className={isLow ? 'stock-pill low' : 'stock-pill healthy'}>{isLow ? 'Low stock' : 'In stock'}</span><button className="receive-quick" title={`Receive ${product.name}`} onClick={onReceive}><Plus size={15} /></button></div>
}

function InventoryTableRow({ product, onReceive, onSell, onEdit }: { product: Product; onReceive: () => void; onSell: () => void; onEdit: () => void }) {
  const expiryDays = daysUntil(product.expiryDate)
  const isLow = product.quantity <= product.reorderLevel
  const expiryLabel = !product.expiryDate ? 'Not set' : expiryDays < 0 ? 'Expired' : expiryDays === 0 ? 'Today' : expiryDays <= 14 ? `${expiryDays} days` : dateLabel(product.expiryDate)
  return <tr><td><div className="table-item"><span className={`product-avatar avatar-${product.category.toLowerCase().replace(/[^a-z]/g, '')}`}>{product.name.slice(0, 1).toUpperCase()}</span><div><strong className="item-name">{product.name}</strong><span className="subline">{product.category}</span></div></div></td><td><strong>{product.quantity}</strong><span className="subline">{product.unit}</span></td><td>{money(product.cost)}</td><td>{money(product.price)}</td><td><span className={expiryDays <= 14 ? 'expiry-text soon' : 'expiry-text'}>{expiryDays <= 14 && <Clock3 size={13} />}{expiryLabel}</span></td><td><span className={isLow ? 'stock-pill low' : 'stock-pill healthy'}><span />{isLow ? 'Low' : 'Healthy'}</span></td><td><div className="row-actions inventory-row-actions"><button className="inventory-action" onClick={onReceive}>Restock</button><button className="inventory-action sell-action" onClick={onSell} disabled={!product.quantity}>Sold</button><button className="inventory-edit-action" title={`Edit ${product.name}`} aria-label={`Edit ${product.name}`} onClick={onEdit}><Pencil size={14} /></button></div></td></tr>
}

function ActivityRow({ movement }: { movement: Movement }) {
  return <div className="activity-row"><span className={`activity-icon ${movement.type}`} >{movement.type === 'purchase' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span><div className="activity-description"><strong>{movement.productName}</strong><span>{movement.type === 'purchase' ? 'Stock received' : 'Sale'} <span className="inline-dot" aria-hidden="true" /> {dateLabel(movement.date)}</span></div><div className="activity-amount"><strong className={movement.type === 'purchase' ? 'positive' : ''}>{movement.type === 'purchase' ? '+' : '-'}{movement.quantity}</strong><span>{money(movement.quantity * movement.unitPrice)}</span></div></div>
}

function EmptyState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><span className="empty-icon"><Package size={19} /></span><strong>{title}</strong><p>{detail}</p>{action && onAction && <button className="button button-secondary" onClick={onAction}><Plus size={15} />{action}</button>}</div>
}

function MovementDialog({ dialog, products, onClose, onSubmit }: {
  dialog: Extract<Dialog, { type: 'movement' }>
  products: Product[]
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>, product: Product, movementType: 'purchase' | 'sale') => void
}) {
  const product = products.find((item) => item.id === dialog.productId) ?? products[0]
  const today = localDate()
  if (!product) return null
  const isPurchase = dialog.movement === 'purchase'
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal movement-modal" role="dialog" aria-modal="true" aria-labelledby="movement-modal-title"><div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{isPurchase ? 'STOCK IN' : 'STOCK OUT'}</div><h2 id="movement-modal-title">{isPurchase ? 'Receive stock' : 'Record a sale'}</h2><p>{product.name} <span className="available-note"><span className="inline-dot" aria-hidden="true" /> {product.quantity} {product.unit} available</span></p></div><button className="icon-button" title="Close" onClick={onClose}><X size={19} /></button></div><form onSubmit={(event) => onSubmit(event, product, dialog.movement)}><div className="form-grid"><label className="field full-field">Item<select name="productId" value={product.id} onChange={() => undefined} disabled>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown className="select-chevron" size={14} /></label><label className="field">Quantity<input name="quantity" type="number" min="0.01" step="any" max={isPurchase ? undefined : product.quantity} placeholder="0" required autoFocus /></label><label className="field">{isPurchase ? 'Unit cost' : 'Selling price'}<input name="unitPrice" type="number" min="0" step="0.01" defaultValue={isPurchase ? product.cost : product.price} required /></label>{isPurchase && <label className="field full-field">New expiration date <span className="optional-label">optional</span><input name="expiryDate" type="date" min={today} /></label>}<label className="field full-field">Note <span className="optional-label">optional</span><input name="note" placeholder={isPurchase ? 'Supplier delivery' : 'Counter sale'} /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary">{isPurchase ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}{isPurchase ? 'Add to stock' : 'Record sale'}</button></div></form></section></div>
}

function EditMovementDialog({ movement, product, onClose, onSubmit }: {
  movement: Movement
  product?: Product
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>, movement: Movement) => void
}) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-movement-title">
      <div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-line" />STOCK ACTIVITY</div><h2 id="edit-movement-title">Edit {movement.type === 'sale' ? 'sale' : 'stock receipt'}</h2><p>{movement.productName} {product ? <><span className="inline-dot" aria-hidden="true" /> {product.quantity} {product.unit} on hand</> : ''}</p></div><button type="button" className="icon-button" title="Close" onClick={onClose}><X size={18} /></button></div>
      <form onSubmit={(event) => onSubmit(event, movement)}>
        <div className="form-grid">
          <label className="field full-field">Item<input value={movement.productName} readOnly /></label>
          <label className="field">Date<input name="date" type="date" defaultValue={movement.date} required /></label>
          <label className="field">Activity<input value={movement.type === 'sale' ? 'Sale' : 'Stock received'} readOnly /></label>
          <label className="field">Quantity<input name="quantity" type="number" min="0.01" step="any" max={movement.type === 'sale' && product ? product.quantity + movement.quantity : undefined} defaultValue={movement.quantity} required autoFocus /></label>
          <label className="field">Unit price<input name="unitPrice" type="number" min="0" step="0.01" defaultValue={movement.unitPrice} required /></label>
          <label className="field full-field">Note <span className="optional-label">optional</span><input name="note" defaultValue={movement.note} /></label>
          {movement.type === 'sale' && <label className="field">Unit cost<input name="unitCost" type="number" min="0" step="0.01" defaultValue={movement.unitCost ?? product?.cost ?? 0} required /></label>}
        </div>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary"><Check size={15} />Save changes</button></div>
      </form>
    </section>
  </div>
}

export default App
