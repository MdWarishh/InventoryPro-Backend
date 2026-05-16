import { sendError } from '../utils/response.js'

export const branchAccess = (req, res, next) => {
  const { user } = req
  const requestedBranchId = req.params.branchId || req.body.branchId || req.query.branchId

  if (user.role === 'SUPER_ADMIN') return next()

  if (!requestedBranchId) return next()

  if (user.branchId !== requestedBranchId) {
    return sendError(res, 'You do not have access to this branch.', 403)
  }

  next()
}

export const getBranchFilter = (user) => {
  if (user.role === 'SUPER_ADMIN') return {}
  return { branchId: user.branchId }
}