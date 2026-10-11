import type { GcashTransaction } from '../SalesPages.tsx'
import type { Movement, Product } from '../types.ts'
import { supabase } from './supabase.ts'

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

function isMissingCategoriesTable(error: { code?: string } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

export async function loadInventory() {
  const [productsResult, movementsResult, gcashResult, categoriesResult] = await Promise.all([
    supabase.from('products').select('*').order('name'),
    supabase.from('movements').select('*').order('date', { ascending: false }),
    supabase.from('gcash_transactions').select('*').order('date', { ascending: false }),
    supabase.from('categories').select('name').order('name'),
  ])
  throwIfError(productsResult.error)
  throwIfError(movementsResult.error)
  throwIfError(gcashResult.error)
  if (categoriesResult.error && !isMissingCategoriesTable(categoriesResult.error)) {
    throwIfError(categoriesResult.error)
  }

  const products: Product[] = (productsResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    quantity: Number(row.quantity),
    unit: row.unit,
    cost: Number(row.cost),
    price: Number(row.price),
    reorderLevel: Number(row.reorder_level),
    expiryDate: row.expiry_date ?? '',
  }))
  const movements: Movement[] = (movementsResult.data ?? []).map((row) => ({
    id: row.id,
    productId: row.product_id ?? '',
    productName: row.product_name,
    type: row.type,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    unitCost: row.unit_cost == null ? undefined : Number(row.unit_cost),
    date: row.date,
    note: row.note,
  }))
  const gcashRecords: GcashTransaction[] = (gcashResult.data ?? []).map((row) => ({
    id: row.id,
    date: row.date,
    service: row.service,
    amount: Number(row.amount),
    fee: Number(row.fee),
    customerName: row.customer_name,
    phoneNumber: row.phone_number,
    reference: row.reference,
  }))
  const categories = categoriesResult.error
    ? [...new Set(products.map((product) => product.category))].sort((left, right) => left.localeCompare(right))
    : (categoriesResult.data ?? []).map((row) => row.name)
  return {
    products,
    movements,
    gcashRecords,
    categories,
    categorySetupRequired: Boolean(categoriesResult.error),
  }
}

export async function addCategory(name: string) {
  const { error } = await supabase.from('categories').insert({ name })
  throwIfError(error)
}

export async function renameCategory(oldName: string, newName: string) {
  const { error } = await supabase.rpc('rename_category', {
    p_old_name: oldName,
    p_new_name: newName,
  })
  throwIfError(error)
}

export async function deleteCategory(name: string) {
  const { error } = await supabase.rpc('delete_category', {
    p_name: name,
  })
  throwIfError(error)
}

export async function importLegacyRecords(
  products: Product[],
  movements: Movement[],
  gcashRecords: GcashTransaction[],
) {
  const { error } = await supabase.rpc('import_legacy_records', {
    p_products: products,
    p_movements: movements,
    p_gcash_transactions: gcashRecords,
  })
  throwIfError(error)
}

export async function createProduct(product: Product, openingMovement?: Movement) {
  const { error } = await supabase.rpc('create_product_with_opening_stock', {
    p_product: product,
    p_movement: openingMovement ?? null,
  })
  throwIfError(error)
}

export async function updateProduct(product: Product) {
  const { error: categoryError } = await supabase.from('categories').upsert(
    { name: product.category },
    { onConflict: 'user_id,name', ignoreDuplicates: true },
  )
  if (categoryError && !isMissingCategoriesTable(categoryError)) throwIfError(categoryError)

  const { data, error } = await supabase.from('products').update({
    name: product.name,
    category: product.category,
    unit: product.unit,
    cost: product.cost,
    price: product.price,
    reorder_level: product.reorderLevel,
    expiry_date: product.expiryDate || null,
  }).eq('id', product.id).select('id').maybeSingle()
  throwIfError(error)
  if (!data) throw new Error('Product was not found or you do not have permission to update it')
}

export async function deleteProduct(id: string) {
  const { error } = await supabase.rpc('delete_product_with_activity', {
    p_product_id: id,
  })
  throwIfError(error)
}

export async function recordMovement(movement: Movement, expiryDate?: string) {
  const { error } = await supabase.rpc('record_stock_movement', {
    p_movement: { ...movement, expiryDate: expiryDate ?? '' },
  })
  throwIfError(error)
}

export async function updateMovement(movement: Movement) {
  const { error } = await supabase.rpc('update_stock_movement', {
    p_movement: movement,
  })
  throwIfError(error)
}

export async function deleteMovement(id: string) {
  const { error } = await supabase.rpc('delete_stock_movement', {
    p_movement_id: id,
  })
  throwIfError(error)
}

export async function saveGcashRecord(record: GcashTransaction) {
  const { error } = await supabase.from('gcash_transactions').upsert({
    id: record.id,
    date: record.date,
    service: record.service,
    amount: record.amount,
    fee: record.fee,
    customer_name: record.customerName,
    phone_number: record.phoneNumber,
    reference: record.reference,
  })
  throwIfError(error)
}

export async function deleteGcashRecord(id: string) {
  const { error } = await supabase.from('gcash_transactions').delete().eq('id', id)
  throwIfError(error)
}
