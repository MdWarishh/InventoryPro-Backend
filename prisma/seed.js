import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  const mainBranch = await prisma.branch.upsert({
    where: { id: 'main-branch-id' },
    update: {},
    create: {
      id: 'main-branch-id',
      name: 'Main Branch',
      address: '123 Main Street, Mumbai, Maharashtra',
      phone: '9876543210',
      email: 'main@company.com',
      isMainBranch: true,
    },
  })
  console.log('✅ Main branch created:', mainBranch.name)

  const branch2 = await prisma.branch.upsert({
    where: { id: 'branch-2-id' },
    update: {},
    create: {
      id: 'branch-2-id',
      name: 'Delhi Branch',
      address: '456 Connaught Place, New Delhi',
      phone: '9876543211',
      email: 'delhi@company.com',
      isMainBranch: false,
    },
  })
  console.log('✅ Branch 2 created:', branch2.name)

  const adminPassword = await bcrypt.hash('Admin@123', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@company.com' },
    update: {},
    create: {
      name: 'Super Admin',
      email: 'admin@company.com',
      password: adminPassword,
      role: 'SUPER_ADMIN',
      branchId: mainBranch.id,
    },
  })
  console.log('✅ Super admin created:', admin.email)

  const branchAdminPassword = await bcrypt.hash('Branch@123', 12)
  const branchAdmin = await prisma.user.upsert({
    where: { email: 'delhi@company.com' },
    update: {},
    create: {
      name: 'Delhi Branch Admin',
      email: 'delhi@company.com',
      password: branchAdminPassword,
      role: 'BRANCH_ADMIN',
      branchId: branch2.id,
    },
  })
  console.log('✅ Branch admin created:', branchAdmin.email)

  await prisma.settings.upsert({
    where: { branchId: mainBranch.id },
    update: {},
    create: {
      branchId: mainBranch.id,
      companyName: 'My Company Pvt Ltd',
      address: '123 Main Street, Mumbai, Maharashtra - 400001',
      phone: '9876543210',
      email: 'info@company.com',
      gstin: '27AAAAA0000A1Z5',
      legalName: 'My Company Private Limited',
      state: 'Maharashtra',
      stateCode: '27',
      defaultGSTRate: 18,
      primaryColor: '#6366f1',
      secondaryColor: '#8b5cf6',
      invoicePrefix: 'INV',
      invoiceTerms: 'Payment due within 30 days. Thank you for your business!',
      currency: 'INR',
      currencySymbol: '₹',
      timezone: 'Asia/Kolkata',
      resetInvoiceMonthly: true,
    },
  })

  await prisma.settings.upsert({
    where: { branchId: branch2.id },
    update: {},
    create: {
      branchId: branch2.id,
      companyName: 'My Company Pvt Ltd - Delhi',
      invoicePrefix: 'DEL',
      currency: 'INR',
      currencySymbol: '₹',
    },
  })
  console.log('✅ Settings created for both branches')

  const categories = [
    { id: 'cat-electronics', name: 'Electronics', color: '#6366f1', description: 'Electronic items and gadgets' },
    { id: 'cat-furniture', name: 'Furniture', color: '#f59e0b', description: 'Home and office furniture' },
    { id: 'cat-clothing', name: 'Clothing', color: '#10b981', description: 'Garments and apparel' },
    { id: 'cat-accessories', name: 'Accessories', color: '#ef4444', description: 'Various accessories' },
  ]

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { id: cat.id },
      update: {},
      create: cat,
    })
  }
  console.log('✅ Categories created')

  const products = [
    {
      id: 'prod-laptop',
      name: 'Laptop 15 inch',
      sku: 'ELE-LAPTOP-001',
      description: 'High performance laptop',
      categoryId: 'cat-electronics',
      unit: 'pcs',
      purchasePrice: 45000,
      sellingPrice: 55000,
      gstRate: 18,
      hsnCode: '8471',
      minStockAlert: 5,
      hasSerialNumbers: true,
    },
    {
      id: 'prod-phone',
      name: 'Smartphone Pro',
      sku: 'ELE-PHONE-001',
      description: 'Latest smartphone',
      categoryId: 'cat-electronics',
      unit: 'pcs',
      purchasePrice: 20000,
      sellingPrice: 28000,
      gstRate: 18,
      hsnCode: '8517',
      minStockAlert: 10,
      hasSerialNumbers: true,
    },
    {
      id: 'prod-chair',
      name: 'Office Chair',
      sku: 'FUR-CHAIR-001',
      description: 'Ergonomic office chair',
      categoryId: 'cat-furniture',
      unit: 'pcs',
      purchasePrice: 5000,
      sellingPrice: 8000,
      gstRate: 12,
      minStockAlert: 5,
      hasSerialNumbers: false,
    },
    {
      id: 'prod-tshirt',
      name: 'Cotton T-Shirt',
      sku: 'CLO-TSHIRT-001',
      description: 'Premium cotton t-shirt',
      categoryId: 'cat-clothing',
      unit: 'pcs',
      purchasePrice: 250,
      sellingPrice: 599,
      gstRate: 5,
      minStockAlert: 20,
      hasSerialNumbers: false,
    },
  ]

  for (const product of products) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: {},
      create: { ...product, images: [] },
    })

    for (const branch of [mainBranch, branch2]) {
      await prisma.productStock.upsert({
        where: { productId_branchId: { productId: product.id, branchId: branch.id } },
        update: {},
        create: { productId: product.id, branchId: branch.id, currentStock: 0 },
      })
    }
  }
  console.log('✅ Products created')

  const dealers = [
    { id: 'dealer-1', name: 'Tech Distributors Pvt Ltd', phone: '9876500001', email: 'tech@dealers.com', city: 'Mumbai', state: 'Maharashtra', gstNumber: '27BBBBB0000B1Z5' },
    { id: 'dealer-2', name: 'Fashion Wholesale Hub', phone: '9876500002', email: 'fashion@dealers.com', city: 'Surat', state: 'Gujarat', gstNumber: '24CCCCC0000C1Z5' },
    { id: 'dealer-3', name: 'Furniture World', phone: '9876500003', email: 'furniture@dealers.com', city: 'Pune', state: 'Maharashtra' },
  ]

  for (const dealer of dealers) {
    await prisma.dealer.upsert({ where: { id: dealer.id }, update: {}, create: dealer })
  }
  console.log('✅ Dealers created')

  const stockInAdmin = await prisma.user.findUnique({ where: { email: 'admin@company.com' } })

  const stockIn1 = await prisma.stockIn.create({
    data: {
      productId: 'prod-laptop',
      branchId: mainBranch.id,
      quantity: 10,
      purchasePrice: 45000,
      dealerId: 'dealer-1',
      sourceNote: 'Initial stock',
      date: new Date(),
      createdBy: stockInAdmin.id,
    },
  })

  await prisma.serialNumber.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({
      serialNumber: `LAPTOP-SN-${String(i + 1).padStart(4, '0')}`,
      productId: 'prod-laptop',
      branchId: mainBranch.id,
      status: 'AVAILABLE',
      stockInId: stockIn1.id,
    })),
    skipDuplicates: true,
  })

  await prisma.productStock.update({
    where: { productId_branchId: { productId: 'prod-laptop', branchId: mainBranch.id } },
    data: { currentStock: 10 },
  })

  await prisma.stockIn.create({
    data: {
      productId: 'prod-chair',
      branchId: mainBranch.id,
      quantity: 25,
      purchasePrice: 5000,
      dealerId: 'dealer-3',
      date: new Date(),
      createdBy: stockInAdmin.id,
    },
  })
  await prisma.productStock.update({
    where: { productId_branchId: { productId: 'prod-chair', branchId: mainBranch.id } },
    data: { currentStock: 25 },
  })

  await prisma.stockIn.create({
    data: {
      productId: 'prod-tshirt',
      branchId: mainBranch.id,
      quantity: 100,
      purchasePrice: 250,
      dealerId: 'dealer-2',
      date: new Date(),
      createdBy: stockInAdmin.id,
    },
  })
  await prisma.productStock.update({
    where: { productId_branchId: { productId: 'prod-tshirt', branchId: mainBranch.id } },
    data: { currentStock: 100 },
  })

  console.log('✅ Sample stock created')

  console.log('\n🎉 Seeding complete!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🔑 Login Credentials:')
  console.log('   Super Admin  → admin@company.com   / Admin@123')
  console.log('   Branch Admin → delhi@company.com   / Branch@123')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
