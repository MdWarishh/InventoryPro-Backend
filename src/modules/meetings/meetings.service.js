// meetings.service.js - COMPLETE UPDATED FILE

import prisma from '../../config/db.js'
import resend from '../../config/resend.js'
import { meetingReminderTemplate } from '../../utils/emailTemplates.js'
import { createNotification } from '../notifications/notifications.service.js'
import whatsappClient from '../../config/whatsapp.js'

// ─── WhatsApp Message Helper ───────────────────────────────────────────────
const sendWhatsAppReminder = async (whatsappNumber, meeting) => {
  try {
    // Number format: 919876543210@c.us (91 = India country code)
    const number = whatsappNumber.replace(/\+/g, '').replace(/\s/g, '')
    const chatId = `${number}@c.us`

    const time = new Date(meeting.startTime).toLocaleTimeString('en-IN', {
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    })

    const date = new Date(meeting.startTime).toLocaleDateString('en-IN', {
      dateStyle: 'medium',
      timeZone: 'Asia/Kolkata',
    })

    const message = `🔔 *Meeting Reminder*\n\n` +
      `📌 *${meeting.title}*\n` +
      `⏰ Starting in *${meeting.reminderMinutes} minutes*\n` +
      `📅 ${date} at ${time}\n` +
      (meeting.location ? `📍 ${meeting.location}\n` : '') +
      (meeting.meetingLink ? `🔗 ${meeting.meetingLink}\n` : '') +
      (meeting.description ? `\n📝 ${meeting.description}` : '')

    await whatsappClient.sendMessage(chatId, message)
    console.log(`✅ WhatsApp reminder sent to ${number}`)
  } catch (err) {
    console.error(`❌ WhatsApp send failed:`, err.message)
  }
}

// ─── Create Meeting ─────────────────────────────────────────────────────────
export const createMeeting = async (data, user) => {
  const { title, description, startTime, endTime, location, meetingLink, type, priority, reminderMinutes, participants, branchId } = data

  const meeting = await prisma.meeting.create({
    data: {
      title, description,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      location, meetingLink,
      type: type || 'INTERNAL',
      priority: priority || 'MEDIUM',
      reminderMinutes: Number(reminderMinutes) || 30,
      branchId: user.role === 'SUPER_ADMIN' ? (branchId || null) : user.branchId,
      createdBy: user.id,
    },
  })

  if (participants?.length) {
    await prisma.meetingParticipant.createMany({
      data: participants.map(p => ({
        meetingId: meeting.id,
        userId: p.userId || null,
        externalName: p.externalName || null,
        externalEmail: p.externalEmail || null,
        status: 'INVITED',
      })),
    })
  }

  return getMeetingById(meeting.id, user)
}

// ─── Get Meeting By ID ──────────────────────────────────────────────────────
export const getMeetingById = async (id, user) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      createdByUser: { select: { id: true, name: true, email: true, whatsappNumber: true } },
      participants: {
        include: { user: { select: { id: true, name: true, email: true, whatsappNumber: true } } },
      },
    },
  })
  if (!meeting) throw { statusCode: 404, message: 'Meeting not found.' }
  return meeting
}

// ─── Get All Meetings ───────────────────────────────────────────────────────
export const getAllMeetings = async (user, { startDate, endDate, status, branchId } = {}) => {
  const where = {}

  if (user.role !== 'SUPER_ADMIN') {
    where.OR = [
      { branchId: user.branchId },
      { createdBy: user.id },
      { participants: { some: { userId: user.id } } },
    ]
  } else if (branchId) {
    where.branchId = branchId
  }

  if (status) where.status = status
  if (startDate || endDate) {
    where.startTime = {}
    if (startDate) where.startTime.gte = new Date(startDate)
    if (endDate) where.startTime.lte = new Date(endDate)
  }

  return prisma.meeting.findMany({
    where,
    include: {
      createdByUser: { select: { name: true } },
      participants: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
    orderBy: { startTime: 'asc' },
  })
}

// ─── Update Meeting ─────────────────────────────────────────────────────────
export const updateMeeting = async (id, data, user) => {
  const meeting = await prisma.meeting.findUnique({ where: { id } })
  if (!meeting) throw { statusCode: 404, message: 'Meeting not found.' }
  if (user.role !== 'SUPER_ADMIN' && meeting.createdBy !== user.id) {
    throw { statusCode: 403, message: 'You can only edit your own meetings.' }
  }

  await prisma.meeting.update({
    where: { id },
    data: {
      title: data.title,
      description: data.description,
      startTime: data.startTime ? new Date(data.startTime) : undefined,
      endTime: data.endTime ? new Date(data.endTime) : undefined,
      location: data.location,
      meetingLink: data.meetingLink,
      type: data.type,
      priority: data.priority,
      status: data.status,
      reminderMinutes: data.reminderMinutes ? Number(data.reminderMinutes) : undefined,
      notes: data.notes,
      reminderSent: data.startTime ? false : undefined,
    },
  })

  if (data.participants) {
    await prisma.meetingParticipant.deleteMany({ where: { meetingId: id } })
    if (data.participants.length) {
      await prisma.meetingParticipant.createMany({
        data: data.participants.map(p => ({
          meetingId: id,
          userId: p.userId || null,
          externalName: p.externalName || null,
          externalEmail: p.externalEmail || null,
          status: 'INVITED',
        })),
      })
    }
  }

  return getMeetingById(id, user)
}

// ─── Delete Meeting ─────────────────────────────────────────────────────────
export const deleteMeeting = async (id, user) => {
  const meeting = await prisma.meeting.findUnique({ where: { id } })
  if (!meeting) throw { statusCode: 404, message: 'Meeting not found.' }
  if (user.role !== 'SUPER_ADMIN' && meeting.createdBy !== user.id) {
    throw { statusCode: 403, message: 'Access denied.' }
  }
  await prisma.meeting.delete({ where: { id } })
}

// ─── Send Meeting Reminders (Cron Job) ──────────────────────────────────────
export const sendMeetingReminders = async () => {
  const now = new Date()

  const meetings = await prisma.meeting.findMany({
    where: {
      status: 'SCHEDULED',
      reminderSent: false,
      startTime: { gt: now },
    },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, email: true, whatsappNumber: true } },
        },
      },
      createdByUser: { select: { id: true, name: true, email: true, whatsappNumber: true } },
    },
  })

  for (const meeting of meetings) {
    const reminderTime = new Date(meeting.startTime.getTime() - meeting.reminderMinutes * 60 * 1000)
    const diffMs = reminderTime.getTime() - now.getTime()

    if (diffMs <= 60000 && diffMs >= -60000) {
      const recipients = [meeting.createdByUser]
      for (const p of meeting.participants) {
        if (p.user && !recipients.find(r => r.id === p.user.id)) {
          recipients.push(p.user)
        }
      }

      for (const recipient of recipients) {
        try {
          // 1. In-app notification ✅
          await createNotification({
            userId: recipient.id,
            title: `Meeting in ${meeting.reminderMinutes} min`,
            message: `"${meeting.title}" starts at ${new Date(meeting.startTime).toLocaleTimeString('en-IN', { timeStyle: 'short' })}`,
            type: 'MEETING_REMINDER',
            relatedId: meeting.id,
          })

          // 2. Email ✅
          const { subject, html } = meetingReminderTemplate({ meeting, userName: recipient.name })
          await resend.emails.send({
            from: process.env.FROM_EMAIL || 'noreply@inventory.com',
            to: recipient.email,
            subject,
            html,
          })

          // 3. WhatsApp ✅ - sirf agar number set hai
          if (recipient.whatsappNumber) {
            await sendWhatsAppReminder(recipient.whatsappNumber, meeting)
          }

        } catch (err) {
          console.error(`Reminder error for meeting ${meeting.id}:`, err.message)
        }
      }

      await prisma.meeting.update({ where: { id: meeting.id }, data: { reminderSent: true } })
      console.log(`✅ Reminder sent for meeting: ${meeting.title}`)
    }
  }
}