import prisma from '../../config/db.js'
import cloudinary from '../../config/cloudinary.js'

export const getSettings = async (branchId, user) => {
  const effectiveBranchId = user.role === 'SUPER_ADMIN' ? branchId : user.branchId
  if (!effectiveBranchId) throw { statusCode: 400, message: 'Branch ID required.' }

  let settings = await prisma.settings.findUnique({ where: { branchId: effectiveBranchId } })
  if (!settings) {
    settings = await prisma.settings.create({ data: { branchId: effectiveBranchId } })
  }
  return settings
}

export const updateSettings = async (branchId, data, user) => {
  const effectiveBranchId = user.role === 'SUPER_ADMIN' ? branchId : user.branchId
  if (!effectiveBranchId) throw { statusCode: 400, message: 'Branch ID required.' }
  if (user.role === 'BRANCH_ADMIN' && user.branchId !== effectiveBranchId) {
    throw { statusCode: 403, message: 'Access denied.' }
  }

  const {
    // Company
    companyName, address, phone, email, website,
    gstin, legalName, state, stateCode,
    // Invoice / Tax
    defaultGSTRate, invoicePrefix, invoiceFooter, invoiceTerms, resetInvoiceMonthly,
    placeOfSupply, placeOfSupplyCode, dueDateTerms, footerServices,
    // Bank
    bankAccountHolder, bankAccountNumber, bankIFSC, bankBranch,
    // Currency / Locale
    currency, currencySymbol, timezone,
    // Appearance
    primaryColor, secondaryColor, footerColor, fontSize, fontFamily,
    customPaymentModes, 
  } = data

  // Build update object — only include keys present in payload
  // Using ?? undefined so empty strings ("") ARE saved, but missing keys are skipped
  const updateData = {
    ...(companyName    !== undefined && { companyName }),
    ...(address        !== undefined && { address }),
    ...(phone          !== undefined && { phone }),
    ...(email          !== undefined && { email }),
    ...(website        !== undefined && { website }),
    ...(gstin          !== undefined && { gstin }),
    ...(legalName      !== undefined && { legalName }),
    ...(state          !== undefined && { state }),
    ...(stateCode      !== undefined && { stateCode }),

    ...(defaultGSTRate      !== undefined && { defaultGSTRate: Number(defaultGSTRate) }),
    ...(invoicePrefix       !== undefined && { invoicePrefix }),
    ...(invoiceFooter       !== undefined && { invoiceFooter }),
    ...(invoiceTerms        !== undefined && { invoiceTerms }),
    ...(resetInvoiceMonthly !== undefined && { resetInvoiceMonthly: Boolean(resetInvoiceMonthly) }),

    ...(placeOfSupply     !== undefined && { placeOfSupply }),
    ...(placeOfSupplyCode !== undefined && { placeOfSupplyCode }),
    ...(dueDateTerms      !== undefined && { dueDateTerms }),
    ...(footerServices    !== undefined && { footerServices }),

    ...(bankAccountHolder !== undefined && { bankAccountHolder }),
    ...(bankAccountNumber !== undefined && { bankAccountNumber }),
    ...(bankIFSC          !== undefined && { bankIFSC }),
    ...(bankBranch        !== undefined && { bankBranch }),

    ...(currency       !== undefined && { currency }),
    ...(currencySymbol !== undefined && { currencySymbol }),
    ...(timezone       !== undefined && { timezone }),

    ...(primaryColor   !== undefined && { primaryColor }),
    ...(secondaryColor !== undefined && { secondaryColor }),
    ...(footerColor    !== undefined && { footerColor }),
    ...(fontSize       !== undefined && { fontSize }),
    ...(fontFamily     !== undefined && { fontFamily }),
    ...(customPaymentModes !== undefined && { customPaymentModes }),
  }

  return prisma.settings.upsert({
    where:  { branchId: effectiveBranchId },
    update: updateData,
    create: {
      branchId: effectiveBranchId,
      // Spread all provided fields with safe defaults for required ones
      ...updateData,
      defaultGSTRate:      updateData.defaultGSTRate      ?? 18,
      invoicePrefix:       updateData.invoicePrefix       ?? 'INV',
      resetInvoiceMonthly: updateData.resetInvoiceMonthly ?? true,
      dueDateTerms:        updateData.dueDateTerms        ?? 'Due on Receipt',
      primaryColor:        updateData.primaryColor        ?? '#6366f1',
      secondaryColor:      updateData.secondaryColor      ?? '#8b5cf6',
      footerColor:         updateData.footerColor         ?? updateData.primaryColor ?? '#6366f1',
      fontSize:            updateData.fontSize            ?? 'md',
      fontFamily:          updateData.fontFamily          ?? 'Inter',
      currency:            updateData.currency            ?? 'INR',
      currencySymbol:      updateData.currencySymbol      ?? '₹',
      timezone:            updateData.timezone            ?? 'Asia/Kolkata',
    },
  })
}

// ── Generic image upload helper ────────────────────────────────────────────────
const uploadImage = async (branchId, filePath, field, user) => {
  const effectiveBranchId =
    user.role === 'SUPER_ADMIN' ? branchId || user.branchId : user.branchId

  if (!effectiveBranchId) throw { statusCode: 400, message: 'Branch ID required.' }

  const settings = await prisma.settings.findUnique({ where: { branchId: effectiveBranchId } })

  // Delete old image from Cloudinary if exists
  if (settings?.[field]) {
    const publicId = settings[field].split('/').slice(-2).join('/').split('.')[0]
    await cloudinary.uploader.destroy(publicId).catch(() => {})
  }

  return prisma.settings.upsert({
    where:  { branchId: effectiveBranchId },
    update: { [field]: filePath },
    create: { branchId: effectiveBranchId, [field]: filePath },
  })
}

export const uploadLogo = async (branchId, filePath, user) =>
  uploadImage(branchId, filePath, 'logo', user)

export const uploadQRCode = async (branchId, filePath, user) =>
  uploadImage(branchId, filePath, 'qrCodeImage', user)

export const uploadAuthorizedSignature = async (branchId, filePath, user) =>
  uploadImage(branchId, filePath, 'authorizedSignature', user)

export const getAllBranchSettings = async () => {
  return prisma.settings.findMany({
    include: { branch: { select: { id: true, name: true, isMainBranch: true } } },
  })
}