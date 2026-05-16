import * as meetingsService from './meetings.service.js'
import { sendSuccess } from '../../utils/response.js'

export const getAll = async (req, res) => {
  const meetings = await meetingsService.getAllMeetings(req.user, req.query)
  sendSuccess(res, meetings)
}

export const getById = async (req, res) => {
  const meeting = await meetingsService.getMeetingById(req.params.id, req.user)
  sendSuccess(res, meeting)
}

export const create = async (req, res) => {
  const meeting = await meetingsService.createMeeting(req.body, req.user)
  sendSuccess(res, meeting, 'Meeting scheduled successfully.', 201)
}

export const update = async (req, res) => {
  const meeting = await meetingsService.updateMeeting(req.params.id, req.body, req.user)
  sendSuccess(res, meeting, 'Meeting updated successfully.')
}

export const remove = async (req, res) => {
  await meetingsService.deleteMeeting(req.params.id, req.user)
  sendSuccess(res, null, 'Meeting deleted successfully.')
}