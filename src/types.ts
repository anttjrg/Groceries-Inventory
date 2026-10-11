export type Product = {
  id: string
  name: string
  category: string
  quantity: number
  unit: string
  cost: number
  price: number
  reorderLevel: number
  expiryDate: string
}

export type Movement = {
  id: string
  productId: string
  productName: string
  type: 'purchase' | 'sale'
  quantity: number
  unitPrice: number
  unitCost?: number
  date: string
  note: string
}
