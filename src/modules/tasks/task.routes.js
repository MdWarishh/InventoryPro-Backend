import { Router } from 'express'
import * as taskController from './task.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()
router.use(authenticate)

// ── All authenticated users ─────────────────────────────────
router.get('/my',            taskController.getMyTasks)      
router.post('/',             taskController.createTask)       // POST /tasks
router.get('/:id',           taskController.getTaskById)      // GET  /tasks/:id
router.patch('/:id',         taskController.updateTask)       // PATCH /tasks/:id
router.delete('/:id',        taskController.deleteTask)       // DELETE /tasks/:id
router.post('/:id/comments', taskController.addComment)       // POST /tasks/:id/comments

// ── Admin only ──────────────────────────────────────────────
router.get('/',              isAdminOrAbove, taskController.getAllTasks)    // GET  /tasks
router.get('/meta/scores',   isAdminOrAbove, taskController.getScoreboard) // GET  /tasks/meta/scores
router.get('/meta/stats',    taskController.getTaskStats)                   // GET  /tasks/meta/stats

export default router