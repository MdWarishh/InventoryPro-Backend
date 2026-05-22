import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ─── Main Branch ───────────────────────────────────────────────
  const mainBranch = await prisma.branch.upsert({
    where: { id: 'main-branch-id' },
    update: {},
    create: {
      id: 'main-branch-id',
      name: 'Main Branch',
      address: '',
      phone: '',
      email: '',
      isMainBranch: true,
    },
  })
  console.log('✅ Main branch created:', mainBranch.name)

  // ─── Super Admin User ──────────────────────────────────────────
  const adminPassword = await bcrypt.hash('Limra@2026', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'limra@hearing.clinic' },
    update: {},
    create: {
      name: 'Super Admin',
      email: 'limra@hearing.clinic',
      password: adminPassword,
      role: 'SUPER_ADMIN',
      branchId: mainBranch.id,
    },
  })
  console.log('✅ Super admin created:', admin.email)

  // ─── Minimal Settings (required for app to not crash) ─────────
  await prisma.settings.upsert({
    where: { branchId: mainBranch.id },
    update: {},
    create: {
      branchId: mainBranch.id,
      companyName: '',
      currency: 'INR',
      currencySymbol: '₹',
      timezone: 'Asia/Kolkata',
      invoicePrefix: 'INV',
    },
  })
  console.log('✅ Minimal settings created')

  console.log('\n🎉 Seeding complete!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🔑 Login Credentials:')
  console.log('   Super Admin → limra@hearing.clinic / Limra@2026')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📭 No products, no stock, no dealers — fresh start!')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())