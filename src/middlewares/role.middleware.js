import { sendError } from '../utils/response.js'

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 'Unauthorized', 401)
    if (!roles.includes(req.user.role)) {
      return sendError(res, 'You do not have permission to perform this action.', 403)
    }
    next()
  }
}

export const isSuperAdmin = authorize('SUPER_ADMIN')
export const isAdminOrAbove = authorize('SUPER_ADMIN', 'BRANCH_ADMIN')
export const isAnyRole = authorize('SUPER_ADMIN', 'BRANCH_ADMIN', 'STAFF')

export const hasPermission = (module, action) => {
  const key = `can${action.charAt(0).toUpperCase()}${action.slice(1)}`

  return (req, res, next) => {
    if (!req.user) return sendError(res, 'Unauthorized', 401)

    if (req.user.role === 'SUPER_ADMIN' || req.user.role === 'BRANCH_ADMIN') {
      return next()
    }

    const perms = req.user.permissions || []
    const modulePerm = perms.find((p) => p.module === module)

    if (modulePerm && modulePerm[key]) {
      return next()
    }

    return sendError(res, 'You do not have permission to perform this action.', 403)
  }
}