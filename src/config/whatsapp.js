import pkg from 'whatsapp-web.js'
const { Client, LocalAuth } = pkg
import qrcode from 'qrcode-terminal'
import os from 'os'

function getChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  if (os.platform() === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  }
  if (os.platform() === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  }
  return '/usr/bin/google-chrome-stable'
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: getChromePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  },
})

client.on('qr', (qr) => {
  console.log('\n📱 WhatsApp QR Code scan karo:\n')
  qrcode.generate(qr, { small: true })
})

client.on('ready', () => console.log('✅ WhatsApp client ready!'))
client.on('auth_failure', (msg) => console.error('❌ Auth failed:', msg))
client.on('disconnected', () => client.initialize())

client.initialize()
export default client