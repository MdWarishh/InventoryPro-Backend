import 'dotenv/config'
import app from './src/app.js'
import { meetingReminderCron } from './src/cron/meetingReminder.cron.js'

const PORT = process.env.PORT || 5000

const server = app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📦 Environment: ${process.env.NODE_ENV}`)

  meetingReminderCron.start()
  console.log(`⏰ Meeting reminder cron started`)

  if (process.env.WHATSAPP_ENABLED === 'true') {
    try {
      const { default: waClient } = await import('./src/config/whatsapp.js')
      await waClient.initialize()
      console.log('📱 WhatsApp client initializing...')
    } catch (err) {
      console.warn('⚠️ WhatsApp init failed (server will continue):', err.message)
    }
  } else {
    console.log('ℹ️  WhatsApp disabled (WHATSAPP_ENABLED != true)')
  }
})

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err.message)

  // WhatsApp / Chrome error se server crash mat karo
  if (
    err.message?.includes('Chrome') ||
    err.message?.includes('puppeteer') ||
    err.message?.includes('Browser') ||
    err.message?.includes('executablePath')
  ) {
    console.warn('⚠️ WhatsApp/Chrome error ignored — server keeps running')
    return
  }

  server.close(() => process.exit(1))
})

process.on('SIGTERM', () => {
  server.close(() => console.log('Process terminated'))
})