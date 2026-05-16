import pkg from 'whatsapp-web.js'
const { Client, LocalAuth } = pkg
import qrcode from 'qrcode-terminal'

const client = new Client({
  authStrategy: new LocalAuth(), // session save hogi, baar baar QR nahi scan karna
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
})

client.on('qr', (qr) => {
  console.log('\n📱 WhatsApp QR Code scan karo:\n')
  qrcode.generate(qr, { small: true })
})

client.on('ready', () => {
  console.log('✅ WhatsApp client ready hai!')
})

client.on('auth_failure', (msg) => {
  console.error('❌ WhatsApp auth failed:', msg)
})

client.on('disconnected', (reason) => {
  console.warn('⚠️ WhatsApp disconnected:', reason)
})

// App start hote hi initialize karo
client.initialize()

export default client