import * as branchesService from './branches.service.js'
import { sendSuccess } from '../../utils/response.js'

export const getAll = async (req, res) => {
  const branches = await branchesService.getAllBranches(req.user)
  sendSuccess(res, branches)
}

export const getById = async (req, res) => {
  const branch = await branchesService.getBranchById(req.params.id, req.user)
  sendSuccess(res, branch)
}

export const create = async (req, res) => {
  const branch = await branchesService.createBranch(req.body)
  sendSuccess(res, branch, 'Branch created successfully.', 201)
}

export const update = async (req, res) => {
  const branch = await branchesService.updateBranch(req.params.id, req.body)
  sendSuccess(res, branch, 'Branch updated successfully.')
}

export const remove = async (req, res) => {
  await branchesService.deleteBranch(req.params.id)
  sendSuccess(res, null, 'Branch deactivated successfully.')
}

export const getStats = async (req, res) => {
  const stats = await branchesService.getBranchStats(req.params.id)
  sendSuccess(res, stats)
}