import * as productsService from './products.service.js'
import { sendSuccess, sendPaginated } from '../../utils/response.js'

export const getAll = async (req, res) => {
  const result = await productsService.getAllProducts(req.user, req.query)
  sendPaginated(res, result.products, result.pagination)
}

export const getById = async (req, res) => {
  const product = await productsService.getProductById(req.params.id, req.user)
  sendSuccess(res, product)
}

export const search = async (req, res) => {
  const { q } = req.query
  if (!q) return sendSuccess(res, [])
  const products = await productsService.searchProducts(q, req.user)
  sendSuccess(res, products)
}

export const create = async (req, res) => {
  const images = req.files?.map(f => f.path) || []
  const product = await productsService.createProduct({ ...req.body, images }, req.user)
  sendSuccess(res, product, 'Product created successfully.', 201)
}

export const update = async (req, res) => {
  const images = req.files?.length ? req.files.map(f => f.path) : undefined

  const data = {
    ...req.body,
    ...(images && { images }),

    // 🔥 FIX BOOLEAN
    hasSerialNumbers:
      req.body.hasSerialNumbers === "true" ||
      req.body.hasSerialNumbers === true,
  }

  // 🔥 REMOVE undefined fields
  const cleanData = Object.fromEntries(
    Object.entries(data).filter(([_, v]) => v !== undefined)
  )

  const product = await productsService.updateProduct(
    req.params.id,
    cleanData
  )

  sendSuccess(res, product, 'Product updated successfully.')
}

export const remove = async (req, res) => {
  await productsService.deleteProduct(req.params.id)
  sendSuccess(res, null, 'Product deleted successfully.')
}