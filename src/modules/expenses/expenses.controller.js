import * as expensesService from './expenses.service.js'
import { sendSuccess } from '../../utils/response.js'

export const create = async (req, res) => {
  const expense = await expensesService.createExpense(req.body, req.user)
  sendSuccess(res, expense, 'Expense added successfully.', 201)
}

export const getAll = async (req, res) => {
  const data = await expensesService.getExpenses(req.query, req.user)
  sendSuccess(res, data)
}

export const getOne = async (req, res) => {
  const expense = await expensesService.getExpenseById(req.params.id, req.user)
  sendSuccess(res, expense)
}

export const update = async (req, res) => {
  const expense = await expensesService.updateExpense(req.params.id, req.body, req.user)
  sendSuccess(res, expense, 'Expense updated successfully.')
}

export const remove = async (req, res) => {
  await expensesService.deleteExpense(req.params.id, req.user)
  sendSuccess(res, null, 'Expense deleted successfully.')
}

export const getStats = async (req, res) => {
  const stats = await expensesService.getExpenseStats(req.query, req.user)
  sendSuccess(res, stats)
}