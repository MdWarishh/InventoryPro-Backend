import 'dotenv/config'
import app from './src/app.js'
import { meetingReminderCron } from './src/cron/meetingReminder.cron.js'

const PORT = process.env.PORT || 5000

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📦 Environment: ${process.env.NODE_ENV}`)
  meetingReminderCron.start()
  console.log(`⏰ Meeting reminder cron started`)
})

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err)
  server.close(() => process.exit(1))
})

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Process terminated')
  })
})