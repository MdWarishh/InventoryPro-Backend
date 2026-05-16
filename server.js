import 'dotenv/config'
import app from './src/app.js'
import { meetingReminderCron } from './src/cron/meetingReminder.cron.js'

const PORT = process.env.PORT || 5000

const server = app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📦 Environment: ${process.env.NODE_ENV}`)

  // Meeting cron start karo
  meetingReminderCron.start()
  console.log(`⏰ Meeting reminder cron started`)

  // WhatsApp ko server start hone ke BAAD initialize karo
  // aur agar Chrome nahi mila to sirf warn karo — server crash mat karo
  if (process.env.WHATSAPP_ENABLED === 'true') {
    try {
      await import('./src/config/whatsapp.js')
      console.log('📱 WhatsApp client initializing...')
    } catch (err) {
      console.warn('⚠️ WhatsApp init failed (server will continue):', err.message)
    }
  } else {
    console.log('ℹ️  WhatsApp disabled (set WHATSAPP_ENABLED=true to enable)')
  }
})

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err)
  // WhatsApp error ki wajah se pura server band mat karo
  if (err.message?.includes('Chrome') || err.message?.includes('puppeteer')) {
    console.warn('⚠️ WhatsApp/Chrome error — server will keep running')
    return
  }
  server.close(() => process.exit(1))
})

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Process terminated')
  })
})