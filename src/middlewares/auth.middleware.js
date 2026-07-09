import jwt from 'jsonwebtoken'
import prisma from '../config/db.js'
import { sendError } from '../utils/response.js'

export const authenticate = async (req, res, next) => {
  try {
    // ✅ token from header OR query
    let token = null

    const authHeader = req.headers.authorization

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1]
    } else if (req.query.token) {
      token = req.query.token
    }

    if (!token) {
      return sendError(res, 'Access denied. No token provided.', 401)
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        branch: true,
        // ← NEW: load module-level permissions so route/service level
        // hasPermission() checks (see role.middleware.js) can use them
        permissions: {
          select: { module: true, canView: true, canCreate: true, canEdit: true, canDelete: true }
        }
      }
    })

    if (!user || !user.isActive) {
      return sendError(res, 'User not found or inactive.', 401)
    }

    req.user = user
    next()
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return sendError(res, 'Token expired.', 401)
    }
    return sendError(res, 'Invalid token.', 401)
  }
}