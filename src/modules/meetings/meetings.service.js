// meetings.service.js — COMPLETE FILE with proper WhatsApp template

import prisma from '../../config/db.js'
import resend from '../../config/resend.js'
import { meetingReminderTemplate } from '../../utils/emailTemplates.js'
import { createNotification } from '../notifications/notifications.service.js'
import whatsappClient from '../../config/whatsapp.js'

// ─── WhatsApp number format karo ───────────────────────────────────────────
// Input:  "+91 9999241243"  ya  "9999-241-243"  ya  "9999241243"
// Output: "919999241243@c.us"
function formatWhatsAppNumber(raw) {
  // Sirf digits rakhlo
  let digits = raw.replace(/\D/g, '')
  // Agar 10 digit hai to India ka code lagao
  if (digits.length === 10) digits = '91' + digits
  return `${digits}@c.us`
}

// ─── Day name helper ────────────────────────────────────────────────────────
function getDayName(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    weekday: 'long',
    timeZone: 'Asia/Kolkata',
  })
}

// ─── Duration helper ────────────────────────────────────────────────────────
function getDuration(startTime, endTime) {
  const mins = Math.round((new Date(endTime) - new Date(startTime)) / 60000)
  if (mins < 60) return `${mins} minutes`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} hour ${m} min` : `${h} hour`
}

// ─── WhatsApp Message Template ─────────────────────────────────────────────
//
// Aisa message jayega (poora detail, ache se formatted):
//
// ━━━━━━━━━━━━━━━━━━━━━━
// 📅 *Meeting Scheduled*
// ━━━━━━━━━━━━━━━━━━━━━━
//
// 📌 *Q4 Review Meeting*
// 👤 Organized by: Rahul Sharma
//
// 📅 *Date:* Wednesday, 15 Jan 2025
// ⏰ *Time:* 3:00 PM – 4:30 PM IST
// ⏱ *Duration:* 1 hour 30 min
// 📍 *Location:* Conference Room B
// 🔗 *Join Link:* https://meet.google.com/abc-xyz
//
// 📝 *Agenda:*
// Q4 targets review and planning for next quarter.
//
// 👥 *Participants (3):*
// • Amit Kumar
// • Priya Singh
// • You
//
// ⏰ Reminder was set for 30 minutes before the meeting.
//
// ━━━━━━━━━━━━━━━━━━━━━━
// _Please be on time. See you there! 🙏_

function buildWhatsAppMessage(meeting, recipientName = null) {
  const startDate = new Date(meeting.startTime)
  const endDate   = new Date(meeting.endTime)

  const day  = getDayName(meeting.startTime)
  const date = startDate.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  })
  const startTime = startDate.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  })
  const endTime = endDate.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  })
  const duration  = getDuration(meeting.startTime, meeting.endTime)
  const organizer = meeting.createdByUser?.name || 'Admin'

  // Participants list (max 5 dikhao, baki "& X more")
  const participantNames = meeting.participants
    .map(p => p.user?.name || p.externalName)
    .filter(Boolean)

  let participantsLine = ''
  if (participantNames.length > 0) {
    const shown = participantNames.slice(0, 5).map(n => `  • ${n}`).join('\n')
    const extra = participantNames.length - 5
    participantsLine =
      `\n👥 *Participants (${participantNames.length}):*\n${shown}` +
      (extra > 0 ? `\n  _...and ${extra} more_` : '')
  }

  // Greeting agar recipient ka naam pata hai
  const greeting = recipientName
    ? `Hello *${recipientName}* 👋\n\n`
    : ''

  // Type aur Priority
  const typeLine     = meeting.type     ? `🏷 *Type:* ${meeting.type.charAt(0) + meeting.type.slice(1).toLowerCase()}` : ''
  const priorityLine = meeting.priority ? `🔺 *Priority:* ${meeting.priority.charAt(0) + meeting.priority.slice(1).toLowerCase()}` : ''

  const message =
    `${greeting}` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 *Meeting Scheduled*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *${meeting.title}*\n` +
    `👤 Organized by: *${organizer}*\n\n` +
    `📅 *Date:* ${day}, ${date}\n` +
    `⏰ *Time:* ${startTime} – ${endTime} IST\n` +
    `⏱ *Duration:* ${duration}\n` +
    (meeting.location  ? `📍 *Location:* ${meeting.location}\n` : '') +
    (meeting.meetingLink ? `🔗 *Join Link:* ${meeting.meetingLink}\n` : '') +
    (typeLine     ? `${typeLine}\n` : '') +
    (priorityLine ? `${priorityLine}\n` : '') +
    (meeting.description ? `\n📝 *Agenda:*\n${meeting.description}\n` : '') +
    (participantsLine ? `${participantsLine}\n` : '') +
    `\n⏰ Reminder set for *${meeting.reminderMinutes} minutes* before the meeting.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Please be on time. See you there! 🙏_`

  return message
}

// ─── WhatsApp Reminder Template (Cron job wala) ────────────────────────────
function buildReminderMessage(meeting, recipientName = null) {
  const startDate = new Date(meeting.startTime)
  const startTime = startDate.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  })
  const date = startDate.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  })

  const greeting = recipientName ? `Hello *${recipientName}* 👋\n\n` : ''

  return (
    `${greeting}` +
    `🔔 *Meeting Reminder!*\n\n` +
    `📌 *${meeting.title}*\n` +
    `⚠️ Starts in *${meeting.reminderMinutes} minutes*\n\n` +
    `📅 ${date} at ${startTime} IST\n` +
    (meeting.location   ? `📍 ${meeting.location}\n`    : '') +
    (meeting.meetingLink ? `🔗 ${meeting.meetingLink}\n` : '') +
    (meeting.description ? `\n📝 ${meeting.description}\n` : '') +
    `\n_Get ready! 🚀_`
  )
}

// ─── Send WhatsApp Message ─────────────────────────────────────────────────
const sendWhatsAppMessage = async (whatsappNumber, message) => {
  try {
    const chatId = formatWhatsAppNumber(whatsappNumber)
    await whatsappClient.sendMessage(chatId, message)
    console.log(`✅ WhatsApp sent to ${chatId}`)
  } catch (err) {
    console.error(`❌ WhatsApp send failed:`, err.message)
    // Throw mat karo — WhatsApp fail hone se meeting create/update fail nahi honi chahiye
  }
}

// ─── HARDCODED TEST NUMBER ─────────────────────────────────────────────────
// "9999-241-243" → formatWhatsAppNumber("9999241243") → "919999241243@c.us"
// Yahan tera number hai jis pe hamesha meeting ka msg jayega
const TEST_NUMBER = '9999241243'

// ─── Create Meeting ─────────────────────────────────────────────────────────
export const createMeeting = async (data, user) => {
  const {
    title, description, startTime, endTime,
    location, meetingLink, type, priority,
    reminderMinutes, participants, branchId,
  } = data

  const meeting = await prisma.meeting.create({
    data: {
      title, description,
      startTime:       new Date(startTime),
      endTime:         new Date(endTime),
      location,        meetingLink,
      type:            type     || 'INTERNAL',
      priority:        priority || 'MEDIUM',
      reminderMinutes: Number(reminderMinutes) || 30,
      branchId:        user.role === 'SUPER_ADMIN' ? (branchId || null) : user.branchId,
      createdBy:       user.id,
    },
  })

  if (participants?.length) {
    await prisma.meetingParticipant.createMany({
      data: participants.map(p => ({
        meetingId:     meeting.id,
        userId:        p.userId       || null,
        externalName:  p.externalName || null,
        externalEmail: p.externalEmail || null,
        status:        'INVITED',
      })),
    })
  }

  // Full meeting fetch karo (participants aur createdByUser ke saath)
  const fullMeeting = await getMeetingById(meeting.id, user)

  // WhatsApp message bhejo — TEST_NUMBER pe hamesha jayega
  const msg = buildWhatsAppMessage(fullMeeting)
  await sendWhatsAppMessage(TEST_NUMBER, msg)

  return fullMeeting
}

// ─── Get Meeting By ID ──────────────────────────────────────────────────────
export const getMeetingById = async (id, user) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      createdByUser: { select: { id: true, name: true, email: true, whatsappNumber: true } },
      participants: {
        include: {
          user: { select: { id: true, name: true, email: true, whatsappNumber: true } },
        },
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
      { branchId:    user.branchId },
      { createdBy:   user.id },
      { participants: { some: { userId: user.id } } },
    ]
  } else if (branchId) {
    where.branchId = branchId
  }

  if (status) where.status = status
  if (startDate || endDate) {
    where.startTime = {}
    if (startDate) where.startTime.gte = new Date(startDate)
    if (endDate)   where.startTime.lte = new Date(endDate)
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
  const existing = await prisma.meeting.findUnique({ where: { id } })
  if (!existing) throw { statusCode: 404, message: 'Meeting not found.' }
  if (user.role !== 'SUPER_ADMIN' && existing.createdBy !== user.id) {
    throw { statusCode: 403, message: 'You can only edit your own meetings.' }
  }

  await prisma.meeting.update({
    where: { id },
    data: {
      title:           data.title,
      description:     data.description,
      startTime:       data.startTime ? new Date(data.startTime) : undefined,
      endTime:         data.endTime   ? new Date(data.endTime)   : undefined,
      location:        data.location,
      meetingLink:     data.meetingLink,
      type:            data.type,
      priority:        data.priority,
      status:          data.status,
      reminderMinutes: data.reminderMinutes ? Number(data.reminderMinutes) : undefined,
      notes:           data.notes,
      reminderSent:    data.startTime ? false : undefined, // time badla → reminder reset
    },
  })

  if (data.participants !== undefined) {
    await prisma.meetingParticipant.deleteMany({ where: { meetingId: id } })
    if (data.participants.length) {
      await prisma.meetingParticipant.createMany({
        data: data.participants.map(p => ({
          meetingId:     id,
          userId:        p.userId       || null,
          externalName:  p.externalName || null,
          externalEmail: p.externalEmail || null,
          status:        'INVITED',
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
// Ye function har minute cron se call hoga
export const sendMeetingReminders = async () => {
  const now = new Date()

  const meetings = await prisma.meeting.findMany({
    where: {
      status:       'SCHEDULED',
      reminderSent: false,
      startTime:    { gt: now },
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
    const diffMs       = reminderTime.getTime() - now.getTime()

    // ±60 second window mein hai to reminder bhejo
    if (diffMs <= 60000 && diffMs >= -60000) {
      const recipients = [meeting.createdByUser]
      for (const p of meeting.participants) {
        if (p.user && !recipients.find(r => r.id === p.user.id)) {
          recipients.push(p.user)
        }
      }

      for (const recipient of recipients) {
        try {
          // 1. In-app notification
          await createNotification({
            userId:    recipient.id,
            title:     `Meeting in ${meeting.reminderMinutes} min`,
            message:   `"${meeting.title}" starts at ${new Date(meeting.startTime).toLocaleTimeString('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' })}`,
            type:      'MEETING_REMINDER',
            relatedId: meeting.id,
          })

          // 2. Email
          const { subject, html } = meetingReminderTemplate({ meeting, userName: recipient.name })
          await resend.emails.send({
            from:    process.env.FROM_EMAIL || 'noreply@inventory.com',
            to:      recipient.email,
            subject, html,
          })

          // 3. WhatsApp — recipient ka number hai to usse bhi bhejo
          if (recipient.whatsappNumber) {
            const reminderMsg = buildReminderMessage(meeting, recipient.name)
            await sendWhatsAppMessage(recipient.whatsappNumber, reminderMsg)
          }
        } catch (err) {
          console.error(`Reminder error for ${meeting.id}:`, err.message)
        }
      }

      // Reminder TEST_NUMBER pe bhi bhejo (tera number)
      const reminderMsg = buildReminderMessage(meeting)
      await sendWhatsAppMessage(TEST_NUMBER, reminderMsg)

      await prisma.meeting.update({
        where: { id: meeting.id },
        data:  { reminderSent: true },
      })

      console.log(`✅ Reminders sent for: ${meeting.title}`)
    }
  }
}