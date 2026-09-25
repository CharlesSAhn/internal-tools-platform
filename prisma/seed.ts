import { prisma } from "../platform/db";
import { seedCore } from "./seed.core";
import { seedKyc } from "./seed.kyc";
import { seedFlags } from "./seed.flags";

async function main() {
  await seedCore();
  await seedKyc();
  await seedFlags();
  console.log("seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
