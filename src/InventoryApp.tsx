import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  BarChart3,
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Search,
  TrendingUp,
  Wallet,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { GcashPage, KeyMetricsPage, PeriodPicker, rangeFor, SalesPage, TablePagination, TABLE_PAGE_SIZE, todayString, type GcashTransaction, type Period } from './SalesPages.tsx'
import type { Movement, Product } from './types.ts'
import {
  addCategory as saveNewCategory,
  createProduct as saveNewProduct,
  deleteCategory as removeCategory,
  deleteProduct as removeProduct,
  deleteMovement as removeMovement,
  deleteGcashRecord,
  importLegacyRecords,
  loadInventory,
  recordMovement as saveMovement,
  renameCategory as saveRenamedCategory,
  saveGcashRecord,
  updateMovement as saveUpdatedMovement,
  updateProduct as saveUpdatedProduct,
} from './lib/inventoryDatabase.ts'
import { supabase } from './lib/supabase.ts'
import type { Session } from '@supabase/supabase-js'
import './anita.css'

type View = 'overview' | 'categories' | 'inventory' | 'activity' | 'sales' | 'gcash' | 'metrics'
type InventoryFilter = 'all' | 'low' | 'expiring'
type Dialog = { type: 'product'; product?: Product } | { type: 'movement'; productId: string; movement: 'purchase' | 'sale' } | null
type LegacyRecords = { products: Product[]; movements: Movement[]; gcashRecords: GcashTransaction[] }
const PRODUCT_PRICE_ERROR = 'Selling price must be higher than unit cost. Lower the unit cost or increase the selling price.'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }
}

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
  const [categories, setCategories] = useState<string[]>([])
  const [view, setView] = useState<View>('overview')
  const [filter, setFilter] = useState<InventoryFilter>('all')
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [inventoryPage, setInventoryPage] = useState(1)
  const [activityPage, setActivityPage] = useState(1)
  const [activityQuery, setActivityQuery] = useState('')
  const [activityPeriod, setActivityPeriod] = useState<Period>('day')
  const [activityDate, setActivityDate] = useState(todayString())
  const [categoryQuery, setCategoryQuery] = useState('')
  const [categoryPage, setCategoryPage] = useState(1)
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [notice, setNotice] = useState('')
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [appInstalled, setAppInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches)
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
          setCategories([])
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
    const handleInstallPrompt = (event: BeforeInstallPromptEvent) => {
      event.preventDefault()
      setInstallPrompt(event)
    }
    const handleAppInstalled = () => {
      setAppInstalled(true)
      setInstallPrompt(null)
      setNotice('Anita is installed and available from your apps menu.')
    }
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
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
      setCategories(data.categories)
      if (data.categorySetupRequired) {
        setNotice('Run the updated supabase/schema.sql to enable category management. Existing inventory remains available.')
      }
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
      setCategories([])
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

  const visibleCategories = categories.filter((category) => category.toLowerCase().includes(categoryQuery.trim().toLowerCase()))
  const totalCategoryPages = Math.max(1, Math.ceil(visibleCategories.length / TABLE_PAGE_SIZE))
  const currentCategoryPage = Math.min(categoryPage, totalCategoryPages)
  const pageCategories = visibleCategories.slice(
    (currentCategoryPage - 1) * TABLE_PAGE_SIZE,
    currentCategoryPage * TABLE_PAGE_SIZE,
  )

  const visibleProducts = products.filter((product) => {
    const matchesQuery = `${product.name} ${product.category}`.toLowerCase().includes(query.toLowerCase())
    const matchesCategory = categoryFilter === 'all' || product.category === categoryFilter
    const matchesFilter = filter === 'all'
      || (filter === 'low' && product.quantity <= product.reorderLevel)
      || (filter === 'expiring' && daysUntil(product.expiryDate) <= 14)
    return matchesQuery && matchesCategory && matchesFilter
  })
  const totalInventoryPages = Math.max(1, Math.ceil(visibleProducts.length / TABLE_PAGE_SIZE))
  const currentInventoryPage = Math.min(inventoryPage, totalInventoryPages)
  const pageStartIndex = (currentInventoryPage - 1) * TABLE_PAGE_SIZE
  const pageProducts = visibleProducts.slice(pageStartIndex, pageStartIndex + TABLE_PAGE_SIZE)
  const firstVisibleItem = visibleProducts.length ? pageStartIndex + 1 : 0
  const lastVisibleItem = Math.min(pageStartIndex + TABLE_PAGE_SIZE, visibleProducts.length)
  const orderedMovements = [...movements].sort((left, right) => right.date.localeCompare(left.date))
  const activityRange = rangeFor(activityDate, activityPeriod)
  const visibleMovements = orderedMovements.filter((movement) => {
    const matchesDate = movement.date >= activityRange.start && movement.date <= activityRange.end
    const activityText = `${movement.productName} ${movement.note} ${movement.type} ${movement.type === 'purchase' ? 'stock in' : 'sale'}`.toLowerCase()
    return matchesDate && activityText.includes(activityQuery.trim().toLowerCase())
  })
  const totalActivityPages = Math.max(1, Math.ceil(visibleMovements.length / TABLE_PAGE_SIZE))
  const currentActivityPage = Math.min(activityPage, totalActivityPages)
  const pageMovements = visibleMovements.slice((currentActivityPage - 1) * TABLE_PAGE_SIZE, currentActivityPage * TABLE_PAGE_SIZE)
  const recentMovements = orderedMovements.slice(0, 6)

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

  async function installApp() {
    if (!installPrompt) {
      setNotice('To install Anita, use your browser menu and choose “Install app” or “Install this site as an app”.')
      return
    }
    try {
      await installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      setInstallPrompt(null)
      if (outcome === 'dismissed') setNotice('App installation was canceled.')
    } catch (error) {
      setNotice(`Could not start app installation: ${error instanceof Error ? error.message : String(error)}`)
    }
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
      category: String(form.get('newCategory')).trim() || String(form.get('category')).trim() || 'Other',
      quantity: Number(form.get('quantity')),
      unit: String(form.get('unit')).trim() || 'item',
      cost: Number(form.get('cost')),
      price: Number(form.get('price')),
      reorderLevel: Number(form.get('reorderLevel')),
      expiryDate: String(form.get('expiryDate')),
    }
    if (product.cost >= product.price) {
      setNotice(PRODUCT_PRICE_ERROR)
      return
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
    setCategories((current) => [...new Set([...current, product.category])].sort((left, right) => left.localeCompare(right)))
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
      category: String(form.get('newCategory')).trim() || String(form.get('category')).trim() || 'Other',
      unit: String(form.get('unit')).trim() || 'item',
      cost: Number(form.get('cost')),
      price: Number(form.get('price')),
      reorderLevel: Number(form.get('reorderLevel')),
      expiryDate: String(form.get('expiryDate')),
    }
    if (updated.cost >= updated.price) {
      setNotice(PRODUCT_PRICE_ERROR)
      return
    }
    try {
      await saveUpdatedProduct(updated)
    } catch (error) {
      setNotice(`Could not update item: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    setProducts((current) => current.map((product) => product.id === original.id ? updated : product))
    setCategories((current) => [...new Set([...current, updated.category])].sort((left, right) => left.localeCompare(right)))
    setDialog(null)
    setNotice(`${updated.name} updated`)
  }


  async function recordMovement(event: FormEvent<HTMLFormElement>, product: Product, movementType: 'purchase' | 'sale') {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const quantity = Number(form.get('quantity'))
    const unitPrice = Number(form.get('unitPrice'))
    const movementDate = String(form.get('date') || today).trim()
    if (movementType === 'sale' && quantity > product.quantity) {
      setNotice(`Only ${product.quantity} ${product.unit} available`)
      return
    }
    const movement: Movement = {
      id: makeId(), productId: product.id, productName: product.name, type: movementType,
      unitCost: movementType === 'sale' ? product.cost : undefined,
      quantity, unitPrice, date: movementDate, note: String(form.get('note')).trim() || (movementType === 'purchase' ? 'Stock received' : 'Counter sale'),
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
    setInventoryPage(1)
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

  async function deleteInventoryProduct(product: Product) {
    if (!window.confirm(`Delete ${product.name} and all of its stock activity records? This cannot be undone.`)) return
    try {
      await removeProduct(product.id)
    } catch (error) {
      setNotice(`Could not delete item: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    setProducts((current) => current.filter((item) => item.id !== product.id))
    setMovements((current) => current.filter((movement) => movement.productId !== product.id))
    setNotice(`${product.name} and its stock activity records deleted`)
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const name = String(form.get('categoryName')).trim()
    if (!name) return
    if (categories.some((category) => category.toLowerCase() === name.toLowerCase())) {
      setNotice(`The category “${name}” already exists`)
      return
    }
    try {
      await saveNewCategory(name)
    } catch (error) {
      setNotice(`Could not add category: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    setCategories((current) => [...current, name].sort((left, right) => left.localeCompare(right)))
    setCategoryPage(1)
    formElement.reset()
    setNotice(`${name} category added`)
  }

  async function renameCategory(event: FormEvent<HTMLFormElement>, oldName: string) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const newName = String(form.get('categoryName')).trim()
    if (!newName) return
    if (newName.toLowerCase() !== oldName.toLowerCase()
      && categories.some((category) => category.toLowerCase() === newName.toLowerCase())) {
      setNotice(`The category “${newName}” already exists`)
      return
    }
    if (newName === oldName) {
      setEditingCategory(null)
      return
    }
    try {
      await saveRenamedCategory(oldName, newName)
    } catch (error) {
      setNotice(`Could not rename category: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    setCategories((current) => current.map((category) => category === oldName ? newName : category)
      .sort((left, right) => left.localeCompare(right)))
    setProducts((current) => current.map((product) => product.category === oldName
      ? { ...product, category: newName }
      : product))
    if (categoryFilter === oldName) setCategoryFilter(newName)
    setEditingCategory(null)
    setNotice(`${oldName} renamed to ${newName}`)
  }

  async function deleteCategory(name: string) {
    const matchingProducts = products.filter((product) => product.category === name)
    const detail = matchingProducts.length
      ? ` This will also permanently delete ${matchingProducts.length} ${matchingProducts.length === 1 ? 'product and its' : 'products and their'} stock activity records.`
      : ''
    if (!window.confirm(`Delete the “${name}” category?${detail} This cannot be undone.`)) return
    try {
      await removeCategory(name)
    } catch (error) {
      setNotice(`Could not delete category: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const productIds = new Set(matchingProducts.map((product) => product.id))
    setCategories((current) => current.filter((category) => category !== name))
    setProducts((current) => current.filter((product) => !productIds.has(product.id)))
    setMovements((current) => current.filter((movement) => !productIds.has(movement.productId)))
    if (categoryFilter === name) setCategoryFilter('all')
    setNotice(`${name} category deleted`)
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setView('overview') }}>
          <span className="brand-mark"><img src="/app-icon.svg" alt="" /></span>
          <span className="brand-name">Anita<small>Store Records</small></span>
        </a>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className={view === 'overview' ? 'nav-link active' : 'nav-link'} onClick={() => { setView('overview'); setMobileNavOpen(false) }}><LayoutDashboard size={18} />Overview</button>
          <button className={view === 'categories' ? 'nav-link active' : 'nav-link'} onClick={() => { setView('categories'); setMobileNavOpen(false) }}><Boxes size={18} />Category<span className="nav-count">{categories.length}</span></button>
          <button className={view === 'inventory' ? 'nav-link active' : 'nav-link'} onClick={() => openInventory()}><Package size={18} />Inventory<span className="nav-count">{products.length}</span></button>
          <button className={view === 'activity' ? 'nav-link active' : 'nav-link'} onClick={() => { setView('activity'); setMobileNavOpen(false) }}><ArrowDownLeft size={18} />Stock activity</button>
          <button className={view === 'sales' ? 'nav-link active' : 'nav-link'} onClick={() => { setView('sales'); setMobileNavOpen(false) }}><TrendingUp size={18} />Sales</button>
          <button className={view === 'gcash' ? 'nav-link active' : 'nav-link'} onClick={() => { setView('gcash'); setMobileNavOpen(false) }}><Wallet size={18} />GCash</button>
          <button className={view === 'metrics' ? 'nav-link active' : 'nav-link'} onClick={() => { setView('metrics'); setMobileNavOpen(false) }}><BarChart3 size={18} />Key metrics</button>
        </nav>
        <div className="side-label side-label-alerts">REMINDERS</div>
        <button className="alert-link" onClick={() => openInventory('low')}><span className="alert-dot low-dot" />Low stock<span className="alert-count">{lowStock.length}</span></button>
        <button className="alert-link" onClick={() => openInventory('expiring')}><span className="alert-dot expiry-dot" />Expiring soon<span className="alert-count">{expiring.length}</span></button>
        <div className="sidebar-bottom">
          <div className="storage-indicator"><span className="storage-pulse" /><span>Connected to database</span><Check size={14} /></div>
          <p>Records sync across devices using your shop account.</p>
          {!appInstalled && <button className="sign-out-button app-install-button" aria-label="Install app" title="Install app" onClick={() => { void installApp() }}><Download size={14} />Install app</button>}
          <button className="sign-out-button" aria-label="Sign out" title="Sign out" onClick={() => { void signOut() }}><LogOut size={16} />Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" title="Open menu" onClick={() => setMobileNavOpen((open) => !open)}><Menu size={20} /></button>
          <div className="breadcrumbs">Anita <span>/</span> <strong>{view === 'overview' ? 'Overview' : view === 'categories' ? 'Category' : view === 'inventory' ? 'Inventory' : view === 'activity' ? 'Stock activity' : view === 'sales' ? 'Sales' : view === 'gcash' ? 'GCash' : 'Key metrics'}</strong></div>
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
              <button className="button button-soft" onClick={() => { setInventoryPage(1); setView('inventory'); setFilter('all') }}><Boxes size={16} />View inventory<ArrowUpRight size={15} /></button>
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
                <div className="panel-heading"><div><h2>Stock overview</h2><p>The items that need your eye first.</p></div><button className="text-link" onClick={() => { setInventoryPage(1); setView('inventory'); setFilter('all') }}>All items <ArrowUpRight size={14} /></button></div>
                {products.length ? <div className="stock-list">{[...products].sort((a, b) => Number(a.quantity > a.reorderLevel) - Number(b.quantity > b.reorderLevel)).slice(0, 5).map((product) => <StockRow key={product.id} product={product} onReceive={() => setDialog({ type: 'movement', productId: product.id, movement: 'purchase' })} />)}</div> : <EmptyState title="Your shelves are waiting" detail="Add your first grocery item to begin tracking stock." action="Add first item" onAction={() => setDialog({ type: 'product' })} />}
              </div>
              <div className="panel activity-panel">
                <div className="panel-heading"><div><h2>Recent activity</h2><p>Purchases and sales, in one place.</p></div><button className="icon-button small-icon" title="View all activity" onClick={() => setView('activity')}><ArrowUpRight size={16} /></button></div>
                {recentMovements.length ? <div className="activity-list">{recentMovements.slice(0, 5).map((movement) => <ActivityRow key={movement.id} movement={movement} />)}</div> : <EmptyState title="No stock activity yet" detail="Purchases and sales will appear here." />}
              </div>
            </section>
            <div className="page-note"><span className="note-spark">?</span>Little by little, every shelf accounted for.</div>
          </>}

          {view === 'categories' && <>
            <section className="page-heading inventory-heading">
              <div><div className="eyebrow"><span className="eyebrow-line" />PRODUCT ORGANIZATION</div><h1>Categories.</h1><p>Add, rename, or remove product categories.</p></div>
            </section>
            <section className="panel category-manager">
              <div className="panel-heading"><div><h2>Add a category</h2><p>Categories are shared across your product catalog.</p></div></div>
              <form className="category-add-form" onSubmit={(event) => { void addCategory(event) }}>
                <label className="field full-field">Category name<input name="categoryName" placeholder="e.g. Bakery" maxLength={80} required /></label>
                <button className="button button-primary" type="submit"><Plus size={16} />Add category</button>
              </form>
              <div className="category-list-heading">
                <div><h2>Existing categories</h2><span className="record-count">{visibleCategories.length} of {categories.length} categories</span></div>
                <label className="search-box category-search"><Search size={15} /><input aria-label="Search categories" placeholder="Search categories..." value={categoryQuery} onChange={(event) => { setCategoryQuery(event.target.value); setCategoryPage(1) }} /></label>
              </div>
              {pageCategories.length ? <div className="category-list">{pageCategories.map((category) => {
                const productCount = products.filter((product) => product.category === category).length
                return <div className="category-row" key={category}>
                  {editingCategory === category
                    ? <form className="category-rename-form" onSubmit={(event) => { void renameCategory(event, category) }}>
                      <label className="visually-hidden" htmlFor="rename-category">Category name</label>
                      <input id="rename-category" name="categoryName" defaultValue={category} maxLength={80} required autoFocus />
                      <button className="button button-primary" type="submit"><Check size={15} />Save</button>
                      <button className="button button-secondary" type="button" onClick={() => setEditingCategory(null)}>Cancel</button>
                    </form>
                    : <>
                      <div className="category-row-info"><strong>{category}</strong><span>{productCount} {productCount === 1 ? 'product' : 'products'}</span></div>
                      <div className="row-actions">
                        <button title={`Rename ${category}`} aria-label={`Rename ${category}`} onClick={() => setEditingCategory(category)}><Pencil size={14} /></button>
                        <button className="category-delete-action" title={`Delete ${category}`} aria-label={`Delete ${category}`} onClick={() => { void deleteCategory(category) }}><Trash2 size={14} /></button>
                      </div>
                    </>}
                </div>
              })}</div> : <div className="empty-table"><Boxes size={24} /><strong>{categoryQuery ? 'No matching categories' : 'No categories yet'}</strong><span>{categoryQuery ? 'Try another category name.' : 'Add a category to organize your inventory.'}</span></div>}
              <TablePagination itemCount={visibleCategories.length} page={currentCategoryPage} onPageChange={setCategoryPage} label="Categories" />
            </section>
          </>}

          {view === 'inventory' && <>
            <section className="page-heading inventory-heading"><div><div className="eyebrow"><span className="eyebrow-line" />PRODUCT CATALOG</div><h1>Your inventory.</h1><p>Keep quantities, prices and best-before dates up to date.</p></div><button className="button button-primary" onClick={() => setDialog({ type: 'product' })}><Plus size={17} />Add item</button></section>
            <div className="inventory-toolbar"><div className="inventory-search-controls"><div className="search-box"><Search size={17} /><input aria-label="Search inventory" placeholder="Search items or categories..." value={query} onChange={(event) => { setInventoryPage(1); setQuery(event.target.value) }} /><kbd>/</kbd></div><label className="category-filter"><span>Category</span><select aria-label="Filter by category" value={categoryFilter} onChange={(event) => { setInventoryPage(1); setCategoryFilter(event.target.value) }}><option value="all">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select><ChevronDown size={14} /></label></div><div className="filter-tabs" role="group" aria-label="Filter inventory">{(['all', 'low', 'expiring'] as InventoryFilter[]).map((filterOption) => <button key={filterOption} className={filter === filterOption ? 'filter-tab selected' : 'filter-tab'} onClick={() => { setInventoryPage(1); setFilter(filterOption) }}>{filterOption === 'all' ? 'All items' : filterOption === 'low' ? `Low stock = ${lowStock.length}` : `Expiring = ${expiring.length}`}</button>)}</div></div>
            <div className="panel table-panel"><div className="table-summary"><span>Showing <strong>{firstVisibleItem}-{lastVisibleItem}</strong> of <strong>{visibleProducts.length}</strong> items</span><span className="table-summary-right">Prices in your local currency</span></div>
              <div className="table-scroll"><table className="inventory-table"><thead><tr><th>ITEM</th><th>ON HAND</th><th>UNIT COST</th><th>SELL PRICE</th><th>EXPIRATION</th><th>STATUS</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{pageProducts.map((product) => <InventoryTableRow key={product.id} product={product} onReceive={() => setDialog({ type: 'movement', productId: product.id, movement: 'purchase' })} onSell={() => setDialog({ type: 'movement', productId: product.id, movement: 'sale' })} onEdit={() => setDialog({ type: 'product', product })} onDelete={() => { void deleteInventoryProduct(product) }} />)}</tbody></table></div>
              {!visibleProducts.length && <div className="empty-table"><Package size={24} /><strong>No matching items</strong><span>Try another search or add a product.</span></div>}
              <TablePagination itemCount={visibleProducts.length} page={currentInventoryPage} onPageChange={setInventoryPage} label="Inventory" />
            </div>
          </>}

          {view === 'activity' && <>
            <section className="page-heading inventory-heading"><div><div className="eyebrow"><span className="eyebrow-line" />MOVEMENT LOG</div><h1>Stock activity.</h1><p>A dated record of everything received and sold.</p></div></section>
            <div className="activity-toolbar">
              <div className="search-box activity-search"><Search size={17} /><input aria-label="Search stock activity" placeholder="Search items or activity..." value={activityQuery} onChange={(event) => { setActivityPage(1); setActivityQuery(event.target.value) }} /></div>
              <PeriodPicker period={activityPeriod} setPeriod={(value) => { setActivityPage(1); setActivityPeriod(value) }} date={activityDate} setDate={(value) => { setActivityPage(1); setActivityDate(value) }} />
            </div>
            <div className="panel log-panel"><div className="table-scroll"><table className="inventory-table movement-table"><thead><tr><th>DATE</th><th>ITEM</th><th>ACTIVITY</th><th>QUANTITY</th><th>UNIT COST</th><th>SALE PRICE</th><th>TOTAL</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{pageMovements.map((movement) => <tr key={movement.id}><td>{dateLabel(movement.date)}</td><td><strong className="item-name">{movement.productName}</strong><span className="subline">{movement.note}</span></td><td><span className={`movement-badge ${movement.type}`}>{movement.type === 'purchase' ? <><ArrowDownLeft size={13} />Stock in</> : <><ArrowUpRight size={13} />Sale</>}</span></td><td>{movement.quantity}</td><td>{money(movement.unitCost ?? movement.unitPrice)}</td><td>{movement.type === 'sale' ? money(movement.unitPrice) : '-'}</td><td><strong>{money(movement.quantity * movement.unitPrice)}</strong></td><td><div className="row-actions"><button title="Edit activity" onClick={() => setEditingMovement(movement)}><Pencil size={14} /></button><button title="Delete activity" onClick={() => deleteMovement(movement.id)}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div>{!visibleMovements.length && <div className="empty-table"><Clock3 size={24} /><strong>{movements.length ? 'No matching activity' : 'No activity recorded'}</strong><span>{movements.length ? 'Try another search or date range.' : 'When you receive stock or record a sale, it will show here.'}</span></div>}<TablePagination itemCount={visibleMovements.length} page={currentActivityPage} onPageChange={setActivityPage} label="Stock activity" /></div>
          </>}
          {view === 'sales' && <SalesPage sales={movements.filter((movement): movement is Movement & { type: 'sale' } => movement.type === 'sale').map((movement) => ({ ...movement, unitCost: movement.unitCost ?? products.find((product) => product.id === movement.productId)?.cost ?? 0 }))} onEdit={(id) => setEditingMovement(movements.find((movement) => movement.id === id) ?? null)} onDelete={deleteMovement} />}
          {view === 'gcash' && <GcashPage records={gcashRecords} onSave={persistGcashRecord} onDelete={removeGcashRecord} />}
          {view === 'metrics' && <KeyMetricsPage sales={movements.filter((movement): movement is Movement & { type: 'sale' } => movement.type === 'sale').map((movement) => ({ ...movement, unitCost: movement.unitCost ?? products.find((product) => product.id === movement.productId)?.cost ?? 0 }))} gcash={gcashRecords} />}
        </div>
        <footer className="main-footer"><span>ANITA'S INVENTORY</span><span>Synced to your shop account</span></footer>
      </main>

      {notice && <div className="toast" role="status"><span className="toast-check"><Check size={14} /></span>{notice}<button title="Dismiss" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {dialog?.type === 'product' && <ProductDialog product={dialog.product} categories={categories} onClose={() => setDialog(null)} onSubmit={(event) => dialog.product ? editProduct(event, dialog.product) : addProduct(event)} />}
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

function ProductDialog({ product, categories, onClose, onSubmit }: {
  product?: Product
  categories: string[]
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const [priceError, setPriceError] = useState('')
  const units = ['piece', 'pack', 'bottle', 'box', 'kg', 'g', 'liter', 'tray', 'loaf', 'cup']
  function validatePrice(form: HTMLFormElement) {
    const values = new FormData(form)
    const cost = String(values.get('cost') ?? '').trim()
    const price = String(values.get('price') ?? '').trim()
    const error = cost && price && Number(cost) >= Number(price) ? PRODUCT_PRICE_ERROR : ''
    setPriceError(error)
    return !error
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!validatePrice(event.currentTarget)) {
      event.preventDefault()
      return
    }
    onSubmit(event)
  }
  function handlePriceChange(form: HTMLFormElement | null) {
    if (form) validatePrice(form)
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
      <div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{product ? 'EDIT PRODUCT' : 'NEW PRODUCT'}</div><h2 id="product-modal-title">{product ? 'Edit item' : 'Add an item'}</h2><p>{product ? 'Update item details. Use stock actions to change quantity.' : 'Set up its shelf details and starting quantity.'}</p></div><button type="button" className="icon-button" title="Close" onClick={onClose}><X size={19} /></button></div>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field full-field">Item name<input name="name" defaultValue={product?.name} placeholder="e.g. Whole wheat bread" required autoFocus /></label>
          <label className="field full-field">Existing category<select name="category" defaultValue={product?.category ?? ''}><option value="">Choose a category</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select><ChevronDown className="select-chevron" size={14} /></label>
          <label className="field full-field">New category <span className="optional-label">optional</span><input name="newCategory" placeholder="Enter a new category" /></label>
          <label className="field">Unit<select name="unit" defaultValue={product?.unit ?? 'piece'}>{!units.includes(product?.unit ?? '') && product?.unit && <option value={product.unit}>{product.unit}</option>}{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select><ChevronDown className="select-chevron" size={14} /></label>
          {product ? <label className="field">On hand<input value={`${product.quantity} ${product.unit}`} readOnly /><span className="field-hint">Change with Receive or Sell.</span></label> : <label className="field">Starting quantity<input name="quantity" type="number" min="0" step="any" defaultValue="0" required /></label>}
          <label className="field">Reorder when at<input name="reorderLevel" type="number" min="0" step="any" defaultValue={product?.reorderLevel ?? 5} required /></label>
          <label className="field">Unit cost<input name="cost" type="number" min="0" step="0.01" defaultValue={product?.cost} placeholder="0.00" required aria-invalid={Boolean(priceError)} aria-describedby={priceError ? 'product-price-error' : undefined} onChange={(event) => handlePriceChange(event.currentTarget.form)} /></label>
          <label className="field">Selling price<input name="price" type="number" min="0" step="0.01" defaultValue={product?.price} placeholder="0.00" required aria-invalid={Boolean(priceError)} aria-describedby={priceError ? 'product-price-error' : undefined} onChange={(event) => handlePriceChange(event.currentTarget.form)} /></label>
          {priceError && <p className="price-validation-error" id="product-price-error" role="alert">{priceError}</p>}
          <label className="field full-field">Expiration date <span className="optional-label">optional</span><input name="expiryDate" type="date" min={localDate()} defaultValue={product?.expiryDate} /></label>
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

function InventoryTableRow({ product, onReceive, onSell, onEdit, onDelete }: { product: Product; onReceive: () => void; onSell: () => void; onEdit: () => void; onDelete: () => void }) {
  const expiryDays = daysUntil(product.expiryDate)
  const isLow = product.quantity <= product.reorderLevel
  const expiryLabel = !product.expiryDate ? 'Not set' : expiryDays < 0 ? 'Expired' : expiryDays === 0 ? 'Today' : expiryDays <= 14 ? `${expiryDays} days` : dateLabel(product.expiryDate)
  return <tr><td><div className="table-item"><span className={`product-avatar avatar-${product.category.toLowerCase().replace(/[^a-z]/g, '')}`}>{product.name.slice(0, 1).toUpperCase()}</span><div><strong className="item-name">{product.name}</strong><span className="subline">{product.category}</span></div></div></td><td><strong>{product.quantity}</strong><span className="subline">{product.unit}</span></td><td>{money(product.cost)}</td><td>{money(product.price)}</td><td><span className={expiryDays <= 14 ? 'expiry-text soon' : 'expiry-text'}>{expiryDays <= 14 && <Clock3 size={13} />}{expiryLabel}</span></td><td><span className={isLow ? 'stock-pill low' : 'stock-pill healthy'}><span />{isLow ? 'Low' : 'Healthy'}</span></td><td><div className="row-actions inventory-row-actions"><button className="inventory-action" onClick={onReceive}>Restock</button><button className="inventory-action sell-action" onClick={onSell} disabled={!product.quantity}>Sold</button><button className="inventory-edit-action" title={`Edit ${product.name}`} aria-label={`Edit ${product.name}`} onClick={onEdit}><Pencil size={14} /></button><button className="inventory-edit-action inventory-delete-action" title={`Delete ${product.name}`} aria-label={`Delete ${product.name}`} onClick={onDelete}><Trash2 size={14} /></button></div></td></tr>
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
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal movement-modal" role="dialog" aria-modal="true" aria-labelledby="movement-modal-title"><div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{isPurchase ? 'STOCK IN' : 'STOCK OUT'}</div><h2 id="movement-modal-title">{isPurchase ? 'Receive stock' : 'Record a sale'}</h2><p>{product.name} <span className="available-note"><span className="inline-dot" aria-hidden="true" /> {product.quantity} {product.unit} available</span></p></div><button className="icon-button" title="Close" onClick={onClose}><X size={19} /></button></div><form onSubmit={(event) => onSubmit(event, product, dialog.movement)}><div className="form-grid"><label className="field full-field">Item<select name="productId" value={product.id} onChange={() => undefined} disabled>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown className="select-chevron" size={14} /></label><label className="field">Quantity<input name="quantity" type="number" min="0.01" step="any" max={isPurchase ? undefined : product.quantity} placeholder="0" required autoFocus /></label><label className="field">Date<input name="date" type="date" max={today} defaultValue={today} required /></label><label className="field">{isPurchase ? 'Unit cost' : 'Selling price'}<input name="unitPrice" type="number" min="0" step="0.01" defaultValue={isPurchase ? product.cost : product.price} required /></label>{isPurchase && <label className="field full-field">New expiration date <span className="optional-label">optional</span><input name="expiryDate" type="date" min={today} /></label>}<label className="field full-field">Note <span className="optional-label">optional</span><input name="note" placeholder={isPurchase ? 'Supplier delivery' : 'Counter sale'} /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary">{isPurchase ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}{isPurchase ? 'Add to stock' : 'Record sale'}</button></div></form></section></div>
}

function EditMovementDialog({ movement, product, onClose, onSubmit }: {
  movement: Movement
  product?: Product
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>, movement: Movement) => void
}) {
  const today = localDate()
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-movement-title">
      <div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-line" />STOCK ACTIVITY</div><h2 id="edit-movement-title">Edit {movement.type === 'sale' ? 'sale' : 'stock receipt'}</h2><p>{movement.productName} {product ? <><span className="inline-dot" aria-hidden="true" /> {product.quantity} {product.unit} on hand</> : ''}</p></div><button type="button" className="icon-button" title="Close" onClick={onClose}><X size={18} /></button></div>
      <form onSubmit={(event) => onSubmit(event, movement)}>
        <div className="form-grid">
          <label className="field full-field">Item<input value={movement.productName} readOnly /></label>
          <label className="field">Date<input name="date" type="date" max={today} defaultValue={movement.date} required /></label>
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
