export const errorMiddleware = (err, req, res, next) => {
  console.error('Error:', err)

  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
    })
  }

  if (err.code === 'P2002') {
    const field = err.meta?.target?.[0] || 'field'
    return res.status(409).json({
      success: false,
      message: `${field} already exists.`
    })
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'Record not found.'
    })
  }

  if (err.message === 'Only Excel/CSV files are allowed') {
    return res.status(400).json({ success: false, message: err.message })
  }

  const statusCode = err.statusCode || 500
  const message = err.message || 'Internal server error'

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  })
}