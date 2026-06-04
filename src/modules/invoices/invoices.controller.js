import * as invoicesService from './invoices.service.js'
import { sendSuccess, sendPaginated } from '../../utils/response.js'

export const getAll = async (req, res) => {
  const result = await invoicesService.getAllInvoices(req.user, req.query)
  sendPaginated(res, result.invoices, result.pagination)
}

export const getById = async (req, res) => {
  const invoice = await invoicesService.getInvoiceById(req.params.id, req.user)
  sendSuccess(res, invoice)
}

export const create = async (req, res) => {
  const invoice = await invoicesService.createInvoice(req.body, req.user)
  sendSuccess(res, invoice, 'Invoice created successfully.', 201)
}

export const resetCounter = async (req, res) => {
  const result = await invoicesService.resetCounter(req.body.branchId, req.user)
  sendSuccess(res, result)
}

export const update = async (req, res) => {
  const invoice = await invoicesService.updateInvoice(req.params.id, req.body, req.user)
  sendSuccess(res, invoice, 'Invoice updated successfully.')
}

export const remove = async (req, res) => {
  const result = await invoicesService.deleteInvoice(req.params.id, req.user)
  sendSuccess(res, result, 'Invoice deleted successfully.')
}