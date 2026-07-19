import * as labelsService from './labels.service.js'
import { sendSuccess } from '../../utils/response.js'

export const getAll = async (req, res) => {
  const labels = await labelsService.getAllLabels(req.user, req.query.branchId)
  sendSuccess(res, labels)
}

export const create = async (req, res) => {
  const label = await labelsService.createLabel(req.body, req.user)
  sendSuccess(res, label, 'Label created successfully.', 201)
}

export const update = async (req, res) => {
  const label = await labelsService.updateLabel(req.params.id, req.body, req.user)
  sendSuccess(res, label, 'Label updated successfully.')
}

export const remove = async (req, res) => {
  const result = await labelsService.deleteLabel(req.params.id, req.user)
  sendSuccess(res, result)
}