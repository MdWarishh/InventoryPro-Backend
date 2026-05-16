import * as categoriesService from './categories.service.js'
import { sendSuccess } from '../../utils/response.js'

export const getAll = async (req, res) => {
  const categories = await categoriesService.getAllCategories(req.user, req.query)
  sendSuccess(res, categories)
}

export const create = async (req, res) => {
  const category = await categoriesService.createCategory(req.body, req.user)
  sendSuccess(res, category, 'Category created successfully.', 201)
}

export const update = async (req, res) => {
  const category = await categoriesService.updateCategory(req.params.id, req.body)
  sendSuccess(res, category, 'Category updated successfully.')
}

export const remove = async (req, res) => {
  await categoriesService.deleteCategory(req.params.id)
  sendSuccess(res, null, 'Category deleted successfully.')
}