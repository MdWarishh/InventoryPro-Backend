import { Router } from 'express'
import { authenticate } from '../middlewares/auth.middleware.js'

class SSEManager {
  constructor() {
    this.clients = new Map()
  }

  addClient(userId, res) {
    if (!this.clients.has(userId)) this.clients.set(userId, new Set())
    this.clients.get(userId).add(res)
  }

  removeClient(userId, res) {
    if (this.clients.has(userId)) {
      this.clients.get(userId).delete(res)
      if (this.clients.get(userId).size === 0) this.clients.delete(userId)
    }
  }

  sendToUser(userId, data) {
    if (!this.clients.has(userId)) return
    const message = `data: ${JSON.stringify(data)}\n\n`
    for (const res of this.clients.get(userId)) {
      try {
        res.write(message)
      } catch {
        this.clients.get(userId).delete(res)
      }
    }
  }

  broadcast(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`
    for (const [, clients] of this.clients) {
      for (const res of clients) {
        try { res.write(message) } catch { }
      }
    }
  }
}

export const sseManager = new SSEManager()

export const sseRouter = Router()

sseRouter.get('/', authenticate, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_URL || 'http://localhost:3000')
  res.flushHeaders()

  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connected' })}\n\n`)

  sseManager.addClient(req.user.id, res)

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n') } catch { clearInterval(heartbeat) }
  }, 30000)

  req.on('close', () => {
    clearInterval(heartbeat)
    sseManager.removeClient(req.user.id, res)
  })
})