export const meetingReminderTemplate = ({ meeting, userName }) => {
  const startTime = new Date(meeting.startTime).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'short',
  })
  const endTime = new Date(meeting.endTime).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    timeStyle: 'short',
  })

  return {
    subject: `Reminder: ${meeting.title} in ${meeting.reminderMinutes} minutes`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <div style="background: #6366f1; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h2 style="margin: 0;">📅 Meeting Reminder</h2>
        </div>
        <div style="padding: 24px;">
          <p style="color: #374151; font-size: 16px;">Hello <strong>${userName}</strong>,</p>
          <p style="color: #6b7280;">Your meeting is starting in <strong style="color: #6366f1;">${meeting.reminderMinutes} minutes</strong>.</p>
          
          <div style="background: #f9fafb; border-left: 4px solid #6366f1; padding: 16px; border-radius: 4px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="color: #6b7280; padding: 6px 0; width: 120px; font-size: 14px;">Title</td>
                <td style="color: #111827; font-weight: bold; font-size: 14px;">${meeting.title}</td>
              </tr>
              <tr>
                <td style="color: #6b7280; padding: 6px 0; font-size: 14px;">Start Time</td>
                <td style="color: #111827; font-size: 14px;">${startTime}</td>
              </tr>
              <tr>
                <td style="color: #6b7280; padding: 6px 0; font-size: 14px;">End Time</td>
                <td style="color: #111827; font-size: 14px;">${endTime}</td>
              </tr>
              ${meeting.location ? `<tr><td style="color: #6b7280; padding: 6px 0; font-size: 14px;">Location</td><td style="color: #111827; font-size: 14px;">${meeting.location}</td></tr>` : ''}
              ${meeting.meetingLink ? `<tr><td style="color: #6b7280; padding: 6px 0; font-size: 14px;">Link</td><td style="font-size: 14px;"><a href="${meeting.meetingLink}" style="color: #6366f1;">Join Meeting</a></td></tr>` : ''}
              ${meeting.description ? `<tr><td style="color: #6b7280; padding: 6px 0; font-size: 14px;">Description</td><td style="color: #111827; font-size: 14px;">${meeting.description}</td></tr>` : ''}
            </table>
          </div>

          ${meeting.meetingLink ? `
            <div style="text-align: center; margin: 24px 0;">
              <a href="${meeting.meetingLink}" style="background: #6366f1; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-size: 16px;">Join Meeting</a>
            </div>
          ` : ''}
        </div>
        <div style="border-top: 1px solid #e5e7eb; padding: 16px; text-align: center; color: #9ca3af; font-size: 12px;">
          This is an automated reminder from your Inventory Management System.
        </div>
      </div>
    `
  }
}

export const lowStockTemplate = ({ productName, branchName, currentStock, minStock }) => ({
  subject: `⚠️ Low Stock Alert: ${productName}`,
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
      <div style="background: #f59e0b; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
        <h2 style="margin: 0;">⚠️ Low Stock Alert</h2>
      </div>
      <div style="padding: 24px;">
        <p style="color: #374151;">The following product has reached its minimum stock threshold:</p>
        <div style="background: #fffbeb; border: 1px solid #f59e0b; padding: 16px; border-radius: 6px; margin: 16px 0;">
          <p style="margin: 0; font-size: 16px; font-weight: bold; color: #111827;">${productName}</p>
          <p style="margin: 4px 0; color: #6b7280; font-size: 14px;">Branch: ${branchName}</p>
          <p style="margin: 4px 0; color: #ef4444; font-size: 14px;">Current Stock: <strong>${currentStock}</strong></p>
          <p style="margin: 4px 0; color: #6b7280; font-size: 14px;">Minimum Threshold: ${minStock}</p>
        </div>
        <p style="color: #6b7280; font-size: 14px;">Please restock this product soon to avoid stockout.</p>
      </div>
    </div>
  `
})