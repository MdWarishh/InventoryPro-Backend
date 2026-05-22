// config/whatsapp.js
// whatsapp-web.js — VPS production setup
// Jis phone se QR scan karega, usi number se messages jayenge.

import pkg from 'whatsapp-web.js'
const { Client, LocalAuth } = pkg
import qrcode from 'qrcode-terminal'
import os from 'os'

// ─── Chrome path auto-detect ───────────────────────────────────────────────
function getChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  if (os.platform() === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  }
  if (os.platform() === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  }
  // VPS (Ubuntu/Debian) ke liye — pehle chromium try karo, phir chrome
  const paths = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ]
  return paths[0] // Chromium VPS pe sabse reliable hai
}

// ─── Client setup ──────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './.wwebjs_auth', // Session yahan save hogi — VPS pe persist rahegi
  }),
  puppeteer: {
    headless: true,
    executablePath: getChromePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--single-process',       // VPS ke liye important — memory kam use hogi
      '--no-zygote',
    ],
  },
})

// ─── Events ────────────────────────────────────────────────────────────────
client.on('qr', (qr) => {
  console.log('\n📱 WhatsApp QR Code — Terminal mein scan karo:\n')
  qrcode.generate(qr, { small: true })
  console.log('\n(Sirf pehli baar scan karna hoga, session save ho jayega)\n')
})

client.on('loading_screen', (percent, message) => {
  console.log(`⏳ WhatsApp loading: ${percent}% — ${message}`)
})

client.on('authenticated', () => {
  console.log('🔐 WhatsApp authenticated — session save ho gayi!')
})

client.on('ready', () => {
  console.log('✅ WhatsApp client ready! Messages ab ja sakte hain.')
})

client.on('auth_failure', (msg) => {
  console.error('❌ WhatsApp auth failed:', msg)
  console.error('Fix: .wwebjs_auth folder delete karo aur dobara QR scan karo')
})

client.on('disconnected', (reason) => {
  console.warn('⚠️ WhatsApp disconnected:', reason)
  console.warn('🔄 5 second baad reconnect hoga...')
  setTimeout(() => {
    client.initialize().catch(err => {
      console.error('Reconnect failed:', err.message)
    })
  }, 5000)
})

// ─── IMPORTANT: initialize() yahan nahi hai ────────────────────────────────
// server.js se call karo (neeche dekhna)

export default client