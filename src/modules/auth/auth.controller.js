import * as authService from './auth.service.js'
import { sendSuccess, sendError } from '../../utils/response.js'
import prisma from '../../config/db.js'

export const login = async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return sendError(res, 'Email and password are required.', 400)

  const data = await authService.loginUser({ email, password })
  sendSuccess(res, data, 'Login successful.')
}

export const refresh = async (req, res) => {
  const { refreshToken } = req.body
  const data = await authService.refreshAccessToken(refreshToken)
  sendSuccess(res, data, 'Token refreshed.')
}

export const logout = async (req, res) => {
  await authService.logoutUser(req.user.id)
  sendSuccess(res, null, 'Logged out successfully.')
}

export const me = async (req, res) => {
  // ✅ req.user me permissions nahi hoti, isliye DB se fresh fetch karo
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      branchId: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      branch: true,
      permissions: {
        select: {
          module: true,
          canView: true,
          canCreate: true,
          canEdit: true,
          canDelete: true,
        },
      },
    },
  })

  sendSuccess(res, user)
}

export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) return sendError(res, 'Both passwords are required.', 400)
  if (newPassword.length < 6) return sendError(res, 'New password must be at least 6 characters.', 400)

  await authService.changePassword(req.user.id, { currentPassword, newPassword })
  sendSuccess(res, null, 'Password changed successfully.')
}