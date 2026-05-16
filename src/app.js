import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import 'express-async-errors'

import authRoutes from './modules/auth/auth.routes.js'
import userRoutes from './modules/users/users.routes.js'
import branchRoutes from './modules/branches/branches.routes.js'
import productRoutes from './modules/products/products.routes.js'
import categoryRoutes from './modules/categories/categories.routes.js'
import dealerRoutes from './modules/dealers/dealers.routes.js'
import stockRoutes from './modules/stock/stock.routes.js'
import serialRoutes from './modules/serial-numbers/serial.routes.js'
import invoiceRoutes from './modules/invoices/invoices.routes.js'
import reportRoutes from './modules/reports/reports.routes.js'
import bulkRoutes from './modules/bulk-upload/bulk.routes.js'
import meetingRoutes from './modules/meetings/meetings.routes.js'
import notificationRoutes from './modules/notifications/notifications.routes.js'
import settingsRoutes from './modules/settings/settings.routes.js'
import { sseRouter } from './sse/sse.manager.js'
import { errorMiddleware } from './middlewares/error.middleware.js'
import attendanceRoutes from './modules/attendance/attendance.routes.js'
import expensesRouter from './modules/expenses/expenses.routes.js'

const app = express()

app.use(helmet())
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}))

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, message: 'Too many requests, please try again later.' }
})
app.use('/api', limiter)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/branches', branchRoutes)
app.use('/api/products', productRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/dealers', dealerRoutes)
app.use('/api/stock', stockRoutes)
app.use('/api/serials', serialRoutes)
app.use('/api/invoices', invoiceRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/bulk-upload', bulkRoutes)
app.use('/api/meetings', meetingRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/sse', sseRouter)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/expenses', expensesRouter)
app.use(errorMiddleware)

export default app