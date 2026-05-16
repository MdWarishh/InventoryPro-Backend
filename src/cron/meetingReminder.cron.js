import cron from 'node-cron'
import { sendMeetingReminders } from '../modules/meetings/meetings.service.js'

export const meetingReminderCron = cron.schedule('* * * * *', async () => {
  try {
    await sendMeetingReminders()
  } catch (err) {
    console.error('Meeting reminder cron error:', err.message)
  }
}, { scheduled: false })