import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import prisma from '../../config/db.js'

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  })
  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  })
  return { accessToken, refreshToken }
}

export const loginUser = async ({ email, password }) => {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      branch: true,
      permissions: {           // ✅ permissions add kiya
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

  if (!user || !user.isActive) throw { statusCode: 401, message: 'Invalid credentials.' }

  const isMatch = await bcrypt.compare(password, user.password)
  if (!isMatch) throw { statusCode: 401, message: 'Invalid credentials.' }

  const { accessToken, refreshToken } = generateTokens(user.id)

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken },
  })

  const { password: _, refreshToken: __, ...userWithoutSensitive } = user
  return { user: userWithoutSensitive, accessToken, refreshToken }
}

export const refreshAccessToken = async (token) => {
  if (!token) throw { statusCode: 401, message: 'Refresh token required.' }

  let decoded
  try {
    decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET)
  } catch {
    throw { statusCode: 401, message: 'Invalid or expired refresh token.' }
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } })
  if (!user || user.refreshToken !== token) {
    throw { statusCode: 401, message: 'Invalid refresh token.' }
  }

  const { accessToken, refreshToken } = generateTokens(user.id)
  await prisma.user.update({ where: { id: user.id }, data: { refreshToken } })

  return { accessToken, refreshToken }
}

export const logoutUser = async (userId) => {
  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken: null },
  })
}

export const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  const isMatch = await bcrypt.compare(currentPassword, user.password)
  if (!isMatch) throw { statusCode: 400, message: 'Current password is incorrect.' }

  const hashed = await bcrypt.hash(newPassword, 12)
  await prisma.user.update({ where: { id: userId }, data: { password: hashed } })
}